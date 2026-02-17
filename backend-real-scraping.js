/**
 * 🏝️ ImmoSearch PF - Backend avec VRAI SCRAPING
 * 
 * Ce backend scrappe réellement les sites immobiliers polynésiens
 * et expose une API REST pour le frontend
 */

const express = require('express');
const puppeteer = require('puppeteer');
const cheerio = require('cheerio');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Configuration du navigateur Puppeteer
let browser = null;

async function getBrowser() {
  if (!browser) {
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ]
    });
  }
  return browser;
}

/**
 * 🔍 SCRAPER POUR PETITESANNONCES.PF
 * Site principal des petites annonces en Polynésie
 */
async function scrapePetitesAnnoncesPF(filters = {}) {
  console.log('🌴 Scraping PetitesAnnonces.pf...');
  
  try {
    // URLs à scraper selon le type de transaction
    const urls = [];
    
    if (filters.transactionType === 'all' || filters.transactionType === 'sale') {
      urls.push('https://www.petitesannonces.pf/immobilier/vente');
    }
    if (filters.transactionType === 'all' || filters.transactionType === 'rent') {
      urls.push('https://www.petitesannonces.pf/immobilier/location');
    }
    
    const allListings = [];
    
    for (const url of urls) {
      try {
        const response = await axios.get(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
          },
          timeout: 15000
        });
        
        const $ = cheerio.load(response.data);
        
        // Sélecteurs adaptés à la structure réelle de petitesannonces.pf
        // Ces sélecteurs sont à ajuster selon la structure HTML réelle
        const selectors = [
          '.listing-item',
          '.annonce-item',
          '.ad-container',
          'article.annonce',
          '.bien-immobilier',
          '[class*="listing"]',
          '[class*="annonce"]'
        ];
        
        let cards = $([]);
        for (const selector of selectors) {
          const found = $(selector);
          if (found.length > 0) {
            cards = found;
            console.log(`✅ Trouvé ${found.length} annonces avec sélecteur: ${selector}`);
            break;
          }
        }
        
        if (cards.length === 0) {
          console.log('⚠️ Aucune annonce trouvée, tentative avec sélecteurs alternatifs...');
          // Fallback: chercher tous les éléments qui contiennent "XPF" ou "F CFP"
          cards = $('*:contains("XPF"), *:contains("F CFP")').closest('div, article, section').slice(0, 20);
        }
        
        cards.each((index, element) => {
          try {
            const $card = $(element);
            const text = $card.text();
            
            // Extraction du titre
            const title = $card.find('h2, h3, h4, .title, [class*="title"]').first().text().trim() 
              || text.split('\n')[0].trim();
            
            // Extraction du prix
            let priceText = $card.find('.price, [class*="prix"], [class*="price"]').first().text().trim();
            if (!priceText) {
              const priceMatch = text.match(/([\d\s]+)\s*(XPF|F\s*CFP)/i);
              if (priceMatch) priceText = priceMatch[0];
            }
            
            // Extraction de la localisation
            let location = $card.find('.location, [class*="ville"], [class*="localisation"]').first().text().trim();
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
            
            // URL de l'annonce
            const link = $card.find('a').first();
            let detailUrl = link.attr('href') || '';
            if (detailUrl && !detailUrl.startsWith('http')) {
              detailUrl = 'https://www.petitesannonces.pf' + detailUrl;
            }
            
            // Description
            let description = $card.find('.description, [class*="desc"], p').first().text().trim();
            if (!description) {
              description = text.split('\n').slice(1, 3).join(' ').trim().substring(0, 150);
            }
            
            // Déterminer le type de transaction
            const transactionType = url.includes('location') ? 'rent' : 'sale';
            
            // Extraction de la surface
            let surface = 0;
            const surfaceMatch = text.match(/(\d+)\s*m[²2]/i);
            if (surfaceMatch) surface = parseInt(surfaceMatch[1]);
            
            // Extraction du type de bien
            let propertyType = 'house';
            const lowerText = text.toLowerCase();
            if (lowerText.includes('appartement') || lowerText.includes('f2') || lowerText.includes('f3')) {
              propertyType = 'apartment';
            } else if (lowerText.includes('villa')) {
              propertyType = 'villa';
            } else if (lowerText.includes('terrain')) {
              propertyType = 'land';
            } else if (lowerText.includes('commercial') || lowerText.includes('bureau')) {
              propertyType = 'commercial';
            }
            
            // Extraction des caractéristiques
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
            
            // Extraction du nombre de pièces
            let rooms = 0;
            const roomMatch = text.match(/(\d+)\s*(?:pièces?|chambres?|P|F)/i);
            if (roomMatch) rooms = parseInt(roomMatch[1]);
            
            // Ne garder que les annonces avec titre et prix
            if (title && priceText && title.length > 5) {
              allListings.push({
                id: `petitesannonces-${Date.now()}-${index}`,
                source: 'petitesannonces-pf',
                sourceName: 'PetitesAnnonces.pf',
                sourceColor: '#F97316',
                title: title.substring(0, 100),
                price: priceText,
                location,
                surface,
                rooms,
                propertyType,
                transactionType,
                features,
                imageUrl,
                url: detailUrl,
                description: description.substring(0, 200),
                dateAdded: new Date().toISOString(),
              });
            }
          } catch (err) {
            console.error('Erreur extraction annonce:', err.message);
          }
        });
      } catch (err) {
        console.error(`Erreur scraping ${url}:`, err.message);
      }
    }
    
    console.log(`✅ PetitesAnnonces.pf: ${allListings.length} annonces extraites`);
    return allListings;
    
  } catch (error) {
    console.error('❌ Erreur globale PetitesAnnonces.pf:', error.message);
    return [];
  }
}

/**
 * 🔍 SCRAPER POUR IMMOBILIER.PF (avec Puppeteer - site dynamique)
 */
async function scrapeImmobilierPF(filters = {}) {
  console.log('🏢 Scraping Immobilier.pf...');
  
  try {
    const browser = await getBrowser();
    const page = await browser.newPage();
    
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    // Construction de l'URL
    let url = 'https://www.immobilier.pf/recherche';
    const params = [];
    
    if (filters.transactionType === 'sale') params.push('transaction=vente');
    if (filters.transactionType === 'rent') params.push('transaction=location');
    if (filters.location && filters.location !== 'all') params.push(`ville=${encodeURIComponent(filters.location)}`);
    
    if (params.length > 0) url += '?' + params.join('&');
    
    await page.goto(url, { 
      waitUntil: 'networkidle2', 
      timeout: 30000 
    });
    
    // Attendre le chargement des annonces
    await page.waitForSelector('body', { timeout: 5000 }).catch(() => {});
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Extraire les données
    const listings = await page.evaluate(() => {
      const results = [];
      
      // Chercher les annonces avec différents sélecteurs
      const selectors = [
        '.property-card',
        '.annonce-card',
        '.listing-item',
        '[class*="bien"]',
        'article',
        '.card'
      ];
      
      let elements = [];
      for (const selector of selectors) {
        elements = document.querySelectorAll(selector);
        if (elements.length > 0) break;
      }
      
      elements.forEach((el, index) => {
        try {
          const text = el.innerText || '';
          
          const titleEl = el.querySelector('h2, h3, h4, .title, [class*="title"]');
          const priceEl = el.querySelector('.price, [class*="prix"]');
          const locationEl = el.querySelector('.location, [class*="ville"]');
          const imageEl = el.querySelector('img');
          const linkEl = el.querySelector('a');
          
          const title = titleEl ? titleEl.innerText.trim() : '';
          const price = priceEl ? priceEl.innerText.trim() : '';
          const location = locationEl ? locationEl.innerText.trim() : '';
          
          if (title && price) {
            results.push({
              title,
              price,
              location: location || 'Non spécifié',
              imageUrl: imageEl ? imageEl.src : '',
              url: linkEl ? linkEl.href : '',
              fullText: text,
            });
          }
        } catch (err) {
          console.error('Erreur extraction:', err);
        }
      });
      
      return results;
    });
    
    await page.close();
    
    // Traiter les résultats
    const processed = listings.map((item, index) => {
      const lowerText = item.fullText.toLowerCase();
      
      return {
        id: `immobilier-pf-${Date.now()}-${index}`,
        source: 'immobilier-pf',
        sourceName: 'Immobilier.pf',
        sourceColor: '#0EA5E9',
        title: item.title,
        price: item.price,
        location: item.location,
        surface: 0,
        rooms: 0,
        propertyType: 'house',
        transactionType: filters.transactionType || 'sale',
        features: [],
        imageUrl: item.imageUrl,
        url: item.url,
        description: item.fullText.substring(0, 150),
        dateAdded: new Date().toISOString(),
      };
    });
    
    console.log(`✅ Immobilier.pf: ${processed.length} annonces extraites`);
    return processed;
    
  } catch (error) {
    console.error('❌ Erreur Immobilier.pf:', error.message);
    return [];
  }
}

/**
 * 🔍 SCRAPER GÉNÉRIQUE pour autres sites
 */
async function scrapeGenericSite(siteName, baseUrl, searchPath) {
  console.log(`🔍 Scraping ${siteName}...`);
  
  try {
    const url = baseUrl + searchPath;
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      timeout: 15000
    });
    
    const $ = cheerio.load(response.data);
    const listings = [];
    
    // Sélecteurs génériques
    $('article, .listing, .property, .annonce, [class*="bien"]').each((index, element) => {
      try {
        const $el = $(element);
        const text = $el.text();
        
        const title = $el.find('h2, h3, h4').first().text().trim();
        const price = $el.find('[class*="prix"], [class*="price"]').first().text().trim();
        
        if (title && price) {
          listings.push({
            id: `${siteName.toLowerCase()}-${Date.now()}-${index}`,
            source: siteName.toLowerCase().replace(/\s+/g, '-'),
            sourceName: siteName,
            sourceColor: '#10B981',
            title,
            price,
            location: 'Non spécifié',
            surface: 0,
            rooms: 0,
            propertyType: 'house',
            transactionType: 'sale',
            features: [],
            imageUrl: $el.find('img').first().attr('src') || '',
            url: baseUrl,
            description: text.substring(0, 100),
            dateAdded: new Date().toISOString(),
          });
        }
      } catch (err) {
        // Ignorer les erreurs
      }
    });
    
    console.log(`✅ ${siteName}: ${listings.length} annonces extraites`);
    return listings;
    
  } catch (error) {
    console.error(`❌ Erreur ${siteName}:`, error.message);
    return [];
  }
}

/**
 * 📊 Normalisation des prix
 */
function normalizePrice(priceStr) {
  try {
    const cleaned = priceStr.replace(/\s/g, '').replace(/[^\d]/g, '');
    let price = parseInt(cleaned);
    
    if (priceStr.toLowerCase().includes('million') || priceStr.toLowerCase().includes('m')) {
      price *= 1000000;
    } else if (priceStr.toLowerCase().includes('k')) {
      price *= 1000;
    }
    
    return price || 0;
  } catch {
    return 0;
  }
}

/**
 * 🎯 ENDPOINT PRINCIPAL - Recherche multi-sources
 */
app.get('/api/search', async (req, res) => {
  try {
    console.log('\n🚀 Nouvelle recherche lancée');
    console.log('Filtres reçus:', req.query);
    
    const filters = {
      transactionType: req.query.transactionType || 'all',
      propertyType: req.query.propertyType || 'all',
      location: req.query.location || 'all',
      minPrice: req.query.minPrice ? parseInt(req.query.minPrice) : null,
      maxPrice: req.query.maxPrice ? parseInt(req.query.maxPrice) : null,
      minSurface: req.query.minSurface ? parseInt(req.query.minSurface) : null,
      maxSurface: req.query.maxSurface ? parseInt(req.query.maxSurface) : null,
    };
    
    const sources = req.query.sources ? req.query.sources.split(',') : [
      'petitesannonces-pf',
      'immobilier-pf'
    ];
    
    console.log('Sources actives:', sources);
    
    // Lancer les scrapers en parallèle
    const scrapePromises = [];
    
    if (sources.includes('petitesannonces-pf')) {
      scrapePromises.push(scrapePetitesAnnoncesPF(filters));
    }
    
    if (sources.includes('immobilier-pf')) {
      scrapePromises.push(scrapeImmobilierPF(filters));
    }
    
    // Autres sites (à activer quand prêt)
    // if (sources.includes('tahiti-immobilier')) {
    //   scrapePromises.push(scrapeGenericSite('Tahiti Immobilier', 'https://www.tahiti-immobilier.pf', '/biens'));
    // }
    
    const results = await Promise.all(scrapePromises);
    let allListings = results.flat();
    
    // Normaliser les prix
    allListings = allListings.map(listing => ({
      ...listing,
      priceNormalized: normalizePrice(listing.price),
    }));
    
    // Appliquer les filtres côté serveur
    let filtered = allListings;
    
    if (filters.minPrice) {
      filtered = filtered.filter(l => l.priceNormalized >= filters.minPrice);
    }
    if (filters.maxPrice) {
      filtered = filtered.filter(l => l.priceNormalized <= filters.maxPrice);
    }
    if (filters.minSurface) {
      filtered = filtered.filter(l => l.surface >= filters.minSurface);
    }
    if (filters.maxSurface) {
      filtered = filtered.filter(l => l.surface <= filters.maxSurface);
    }
    if (filters.propertyType !== 'all') {
      filtered = filtered.filter(l => l.propertyType === filters.propertyType);
    }
    
    console.log(`✅ Total: ${filtered.length} annonces agrégées et filtrées\n`);
    
    res.json({
      success: true,
      count: filtered.length,
      listings: filtered,
      sources: sources,
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
 * 💚 Health check
 */
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    message: 'ImmoSearch PF API avec VRAI SCRAPING',
    timestamp: new Date().toISOString(),
  });
});

/**
 * 📋 Liste des sources
 */
app.get('/api/sources', (req, res) => {
  res.json({
    sources: [
      { id: 'petitesannonces-pf', name: 'PetitesAnnonces.pf', status: 'active' },
      { id: 'immobilier-pf', name: 'Immobilier.pf', status: 'active' },
      { id: 'tahiti-immobilier', name: 'Tahiti Immobilier', status: 'coming-soon' },
      { id: 'pacifique-immo', name: 'Pacifique Immo', status: 'coming-soon' },
      { id: 'fenua-immo', name: 'Fenua Immo', status: 'coming-soon' },
    ]
  });
});

// Nettoyage à la fermeture
process.on('SIGINT', async () => {
  if (browser) {
    await browser.close();
  }
  process.exit();
});

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log('\n🏝️ ========================================');
  console.log('   ImmoSearch PF - Backend avec VRAI SCRAPING');
  console.log('🏝️ ========================================\n');
  console.log(`🚀 Serveur démarré sur le port ${PORT}`);
  console.log(`📍 API: http://localhost:${PORT}/api/search`);
  console.log(`💚 Health: http://localhost:${PORT}/api/health`);
  console.log(`📋 Sources: http://localhost:${PORT}/api/sources\n`);
  console.log('✨ Scraping actif pour:');
  console.log('   - PetitesAnnonces.pf');
  console.log('   - Immobilier.pf');
  console.log('\n');
});

module.exports = app;
