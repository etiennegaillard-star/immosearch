/**
 * ImmoSearch PF - Backend avec les VRAIES URLs
 */

const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

/**
 * Scraper pour PetitesAnnonces.pf avec les vraies URLs
 */
async function scrapePetitesAnnoncesPF(filters = {}) {
  console.log('🔍 Scraping PetitesAnnonces.pf...');
  
  try {
    // Les 8 catégories immobilières
    const urls = [
      'https://www.petites-annonces.pf/annonces.php?c=1',
      'https://www.petites-annonces.pf/annonces.php?c=2',
      'https://www.petites-annonces.pf/annonces.php?c=3',
      'https://www.petites-annonces.pf/annonces.php?c=4',
      'https://www.petites-annonces.pf/annonces.php?c=5',
      'https://www.petites-annonces.pf/annonces.php?c=6',
      'https://www.petites-annonces.pf/annonces.php?c=7',
      'https://www.petites-annonces.pf/annonces.php?c=8',
    ];
    
    const allListings = [];
    
    // Scraper chaque catégorie
    for (const url of urls) {
      try {
        console.log(`  Scraping ${url}...`);
        
        const response = await axios.get(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml',
          },
          timeout: 10000
        });
        
        const $ = cheerio.load(response.data);
        
        // Chercher les annonces avec différents sélecteurs possibles
        const selectors = [
          '.annonce',
          '.listing',
          'article',
          '.ad',
          '.classified',
          '[class*="annonce"]',
          '[class*="listing"]',
          'tr[class*="ligne"]',
          'div[class*="item"]',
        ];
        
        let cards = $([]);
        for (const selector of selectors) {
          const found = $(selector);
          if (found.length > 0) {
            cards = found;
            console.log(`    ✓ ${found.length} éléments avec: ${selector}`);
            break;
          }
        }
        
        // Si aucun sélecteur standard ne marche, chercher les éléments contenant "XPF"
        if (cards.length === 0) {
          $('*').each((i, el) => {
            const $el = $(el);
            const text = $el.text();
            if ((text.includes('XPF') || text.includes('F CFP')) && text.length < 500) {
              cards = cards.add($el);
            }
          });
          cards = cards.slice(0, 30);
          console.log(`    ⚠ Méthode alternative: ${cards.length} éléments`);
        }
        
        cards.each((index, element) => {
          try {
            const $card = $(element);
            const text = $card.text();
            
            // Titre
            const title = $card.find('h1, h2, h3, h4, strong, b, [class*="title"]')
              .first()
              .text()
              .trim() || text.split('\n')[0].trim();
            
            // Prix
            let priceText = $card.find('[class*="prix"], [class*="price"]')
              .first()
              .text()
              .trim();
            
            if (!priceText) {
              const priceMatch = text.match(/([\d\s]+)\s*(XPF|F\s*CFP)/i);
              if (priceMatch) priceText = priceMatch[0];
            }
            
            // Localisation
            let location = $card.find('[class*="ville"], [class*="localisation"], [class*="location"]')
              .first()
              .text()
              .trim();
            
            if (!location) {
              const locationMatch = text.match(/(?:à|À)\s+([A-Z][a-zéèêàâù]+(?:\s+[A-Z][a-zéèêàâù]+)?)/);
              if (locationMatch) location = locationMatch[1];
            }
            location = location || 'Tahiti';
            
            // Image
            const img = $card.find('img').first();
            let imageUrl = img.attr('src') || img.attr('data-src') || '';
            if (imageUrl && !imageUrl.startsWith('http')) {
              imageUrl = 'https://www.petites-annonces.pf/' + imageUrl.replace(/^\//, '');
            }
            
            // URL annonce
            const link = $card.find('a').first();
            let detailUrl = link.attr('href') || '';
            if (detailUrl && !detailUrl.startsWith('http')) {
              detailUrl = 'https://www.petites-annonces.pf/' + detailUrl.replace(/^\//, '');
            }
            
            // Description
            let description = $card.find('p, [class*="desc"]')
              .first()
              .text()
              .trim();
            
            if (!description) {
              description = text
                .split('\n')
                .filter(line => line.trim().length > 20)
                .slice(0, 2)
                .join(' ')
                .trim();
            }
            
            // Type de transaction
            const lowerText = text.toLowerCase();
            const transactionType = (lowerText.includes('location') || lowerText.includes('louer') || lowerText.includes('loyer'))
              ? 'rent' 
              : 'sale';
            
            // Surface
            let surface = 0;
            const surfaceMatch = text.match(/(\d+)\s*m[²2]/i);
            if (surfaceMatch) surface = parseInt(surfaceMatch[1]);
            
            // Type de bien
            let propertyType = 'Maison';
            if (lowerText.includes('appartement') || lowerText.includes(' f2') || lowerText.includes(' f3') || lowerText.includes(' f4')) {
              propertyType = 'Appartement';
            } else if (lowerText.includes('villa')) {
              propertyType = 'Villa';
            } else if (lowerText.includes('terrain')) {
              propertyType = 'Terrain';
            } else if (lowerText.includes('commercial') || lowerText.includes('bureau') || lowerText.includes('local')) {
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
            if (lowerText.includes('vue mer') || lowerText.includes('vue sur mer')) features.push('seaview');
            
            // Nombre de pièces
            let rooms = 0;
            const roomMatch = text.match(/(\d+)\s*(?:pièces?|chambres?|P(?!\w)|F\d)/i);
            if (roomMatch) rooms = parseInt(roomMatch[1]);
            
            // Valider l'annonce
            if (title && priceText && title.length > 5 && priceText.length > 2) {
              const priceNormalized = parseInt(priceText.replace(/\D/g, '')) || 0;
              
              if (priceNormalized > 0) {
                allListings.push({
                  id: `pa-${Date.now()}-${allListings.length}`,
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
                  imageUrl: imageUrl || `https://picsum.photos/seed/${allListings.length}/600/400`,
                  url: detailUrl,
                  description: description.substring(0, 300),
                  dateAdded: new Date().toISOString(),
                });
              }
            }
          } catch (err) {
            // Ignorer les erreurs d'extraction individuelle
          }
        });
        
      } catch (err) {
        console.error(`  ❌ Erreur ${url}:`, err.message);
      }
    }
    
    console.log(`✅ Total PetitesAnnonces.pf: ${allListings.length} annonces`);
    return allListings;
    
  } catch (error) {
    console.error('❌ Erreur globale:', error.message);
    return [];
  }
}

/**
 * Route principale
 */
app.get('/api/search', async (req, res) => {
  try {
    console.log('\n🚀 Recherche');
    
    const filters = {
      transactionType: req.query.transactionType || 'all',
      propertyType: req.query.propertyType || 'all',
      location: req.query.location || 'all',
      minPrice: req.query.minPrice ? parseInt(req.query.minPrice) : null,
      maxPrice: req.query.maxPrice ? parseInt(req.query.maxPrice) : null,
    };
    
    let allListings = await scrapePetitesAnnoncesPF(filters);
    
    // Filtrer
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
    
    console.log(`✅ Résultat: ${filtered.length} annonces\n`);
    
    res.json({
      success: true,
      count: filtered.length,
      listings: filtered,
      sources: ['petitesannonces-pf'],
      timestamp: new Date().toISOString(),
    });
    
  } catch (error) {
    console.error('❌ Erreur:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    message: 'ImmoSearch PF API - Vraies URLs',
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/sources', (req, res) => {
  res.json({
    sources: [
      { id: 'petitesannonces-pf', name: 'PetitesAnnonces.pf', status: 'active' },
    ]
  });
});

const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
  console.log('\n🏝️ ImmoSearch PF - Backend');
  console.log(`🚀 Port ${PORT}`);
  console.log(`📍 API: http://localhost:${PORT}/api/search\n`);
});

module.exports = app;
