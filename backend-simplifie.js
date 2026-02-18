/**
 * ImmoSearch PF - Backend simplifié (sans Puppeteer)
 * Scraping avec Cheerio uniquement - compatible plan gratuit Render
 */

const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const SCRAPER_CONFIG = {
  'petitesannonces-pf': {
    name: 'PetitesAnnonces.pf',
    baseUrl: 'https://www.petitesannonces.pf',
    searchUrl: 'https://www.petitesannonces.pf/immobilier',
  },
};

/**
 * Scraper pour PetitesAnnonces.pf
 */
async function scrapePetitesAnnoncesPF(filters = {}) {
  console.log('🔍 Scraping PetitesAnnonces.pf...');
  
  try {
    let url = SCRAPER_CONFIG['petitesannonces-pf'].searchUrl;
    
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml',
      },
      timeout: 15000
    });
    
    const $ = cheerio.load(response.data);
    const listings = [];
    
    // Sélecteurs multiples pour s'adapter à différentes structures
    const selectors = [
      '.annonce',
      '.listing',
      'article',
      '.ad-item',
      '[class*="bien"]',
      '[class*="listing"]'
    ];
    
    let cards = $([]);
    for (const selector of selectors) {
      const found = $(selector);
      if (found.length > 0) {
        cards = found;
        console.log(`✅ Trouvé ${found.length} éléments avec: ${selector}`);
        break;
      }
    }
    
    if (cards.length === 0) {
      console.log('⚠️ Aucun sélecteur standard trouvé, extraction alternative...');
      // Chercher tous les éléments contenant du texte avec "XPF" ou "F CFP"
      $('*:contains("XPF"), *:contains("F CFP")').each((i, el) => {
        const $el = $(el);
        if ($el.find('*:contains("XPF"), *:contains("F CFP")').length === 0) {
          cards = cards.add($el);
        }
      });
      cards = cards.slice(0, 50); // Limiter
    }
    
    cards.each((index, element) => {
      try {
        const $card = $(element);
        const text = $card.text();
        
        // Extraction du titre
        const title = $card.find('h1, h2, h3, h4, .title, [class*="title"]')
          .first()
          .text()
          .trim() || text.split('\n')[0].trim().substring(0, 100);
        
        // Extraction du prix
        let priceText = $card.find('.price, [class*="prix"], [class*="price"]')
          .first()
          .text()
          .trim();
        
        if (!priceText) {
          const priceMatch = text.match(/([\d\s]+)\s*(XPF|F\s*CFP)/i);
          if (priceMatch) priceText = priceMatch[0];
        }
        
        // Extraction localisation
        let location = $card.find('.location, [class*="ville"], [class*="localisation"]')
          .first()
          .text()
          .trim();
        
        if (!location) {
          const locationMatch = text.match(/(?:à|À)\s+([A-Z][a-zéèêàâù]+(?:\s+[A-Z][a-zéèêàâù]+)?)/);
          if (locationMatch) location = locationMatch[1];
        }
        location = location || 'Non spécifié';
        
        // Image
        const img = $card.find('img').first();
        let imageUrl = img.attr('src') || img.attr('data-src') || '';
        if (imageUrl && !imageUrl.startsWith('http')) {
          imageUrl = 'https://www.petitesannonces.pf' + imageUrl;
        }
        
        // URL
        const link = $card.find('a').first();
        let detailUrl = link.attr('href') || '';
        if (detailUrl && !detailUrl.startsWith('http')) {
          detailUrl = 'https://www.petitesannonces.pf' + detailUrl;
        }
        
        // Description
        let description = $card.find('.description, [class*="desc"], p')
          .first()
          .text()
          .trim();
        
        if (!description) {
          description = text.split('\n')
            .filter(line => line.trim().length > 20)
            .slice(0, 2)
            .join(' ')
            .trim()
            .substring(0, 200);
        }
        
        // Type de transaction
        const lowerText = text.toLowerCase();
        const transactionType = (lowerText.includes('location') || lowerText.includes('louer')) 
          ? 'rent' 
          : 'sale';
        
        // Surface
        let surface = 0;
        const surfaceMatch = text.match(/(\d+)\s*m[²2]/i);
        if (surfaceMatch) surface = parseInt(surfaceMatch[1]);
        
        // Type de bien
        let propertyType = 'Maison';
        if (lowerText.includes('appartement') || lowerText.includes('f2') || lowerText.includes('f3')) {
          propertyType = 'Appartement';
        } else if (lowerText.includes('villa')) {
          propertyType = 'Villa';
        } else if (lowerText.includes('terrain')) {
          propertyType = 'Terrain';
        } else if (lowerText.includes('commercial') || lowerText.includes('bureau')) {
          propertyType = 'Commercial';
        }
        
        // Caractéristiques
        const features = [];
        if (lowerText.includes('jardin')) features.push('garden');
        if (lowerText.includes('terrasse')) features.push('terrace');
        if (lowerText.includes('balcon')) features.push('balcony');
        if (lowerText.includes('garage')) features.push('garage');
        if (lowerText.includes('parking')) features.push('parking');
        if (lowerText.includes('piscine')) features.push('pool');
        if (lowerText.includes('meublé')) features.push('furnished');
        if (lowerText.includes('climatisation') || lowerText.includes('clim')) features.push('aircon');
        if (lowerText.includes('internet') || lowerText.includes('wifi')) features.push('internet');
        if (lowerText.includes('vue mer')) features.push('seaview');
        
        // Nombre de pièces
        let rooms = 0;
        const roomMatch = text.match(/(\d+)\s*(?:pièces?|chambres?|P|F\d)/i);
        if (roomMatch) rooms = parseInt(roomMatch[1]);
        
        // Ne garder que les annonces valides
        if (title && priceText && title.length > 5 && priceText.length > 2) {
          // Normaliser le prix
          const priceNormalized = parseInt(priceText.replace(/\D/g, '')) || 0;
          
          listings.push({
            id: `pa-${Date.now()}-${index}`,
            source: 'petitesannonces-pf',
            sourceName: 'PetitesAnnonces.pf',
            sourceColor: '#F97316',
            title: title.substring(0, 150),
            price: priceNormalized,
            priceText: priceText,
            priceNormalized: priceNormalized,
            location: location.substring(0, 50),
            surface,
            rooms,
            propertyType,
            type: propertyType,
            transactionType,
            features,
            imageUrl,
            url: detailUrl,
            description: description.substring(0, 300),
            dateAdded: new Date().toISOString(),
          });
        }
      } catch (err) {
        console.error('Erreur extraction annonce:', err.message);
      }
    });
    
    console.log(`✅ PetitesAnnonces.pf: ${listings.length} annonces extraites`);
    return listings;
    
  } catch (error) {
    console.error('❌ Erreur scraping PetitesAnnonces.pf:', error.message);
    return [];
  }
}

/**
 * Route principale
 */
app.get('/api/search', async (req, res) => {
  try {
    console.log('\n🚀 Nouvelle recherche');
    console.log('Filtres:', req.query);
    
    const filters = {
      transactionType: req.query.transactionType || 'all',
      propertyType: req.query.propertyType || 'all',
      location: req.query.location || 'all',
      minPrice: req.query.minPrice ? parseInt(req.query.minPrice) : null,
      maxPrice: req.query.maxPrice ? parseInt(req.query.maxPrice) : null,
    };
    
    // Scraper PetitesAnnonces.pf
    let allListings = await scrapePetitesAnnoncesPF(filters);
    
    // Filtrer côté serveur
    let filtered = allListings;
    
    if (filters.transactionType !== 'all') {
      filtered = filtered.filter(l => l.transactionType === filters.transactionType);
    }
    
    if (filters.minPrice) {
      filtered = filtered.filter(l => l.priceNormalized >= filters.minPrice);
    }
    
    if (filters.maxPrice) {
      filtered = filtered.filter(l => l.priceNormalized <= filters.maxPrice);
    }
    
    if (filters.propertyType !== 'all') {
      filtered = filtered.filter(l => l.propertyType === filters.propertyType || l.type === filters.propertyType);
    }
    
    if (filters.location !== 'all') {
      filtered = filtered.filter(l => l.location === filters.location);
    }
    
    console.log(`✅ Total: ${filtered.length} annonces\n`);
    
    res.json({
      success: true,
      count: filtered.length,
      listings: filtered,
      sources: ['petitesannonces-pf'],
      timestamp: new Date().toISOString(),
    });
    
  } catch (error) {
    console.error('❌ Erreur serveur:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * Health check
 */
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    message: 'ImmoSearch PF API - Version simplifiée',
    timestamp: new Date().toISOString(),
  });
});

/**
 * Sources disponibles
 */
app.get('/api/sources', (req, res) => {
  res.json({
    sources: [
      { id: 'petitesannonces-pf', name: 'PetitesAnnonces.pf', status: 'active' },
    ]
  });
});

const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
  console.log('\n🏝️ ========================================');
  console.log('   ImmoSearch PF - Backend simplifié');
  console.log('🏝️ ========================================\n');
  console.log(`🚀 Serveur sur le port ${PORT}`);
  console.log(`📍 API: http://localhost:${PORT}/api/search`);
  console.log(`💚 Health: http://localhost:${PORT}/api/health\n`);
});

module.exports = app;
