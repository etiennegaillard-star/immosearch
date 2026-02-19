/**
 * ImmoSearch PF - Backend AMÉLIORÉ avec scraping précis
 */

const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

/**
 * Scraper AMÉLIORÉ pour PetitesAnnonces.pf
 */
async function scrapePetitesAnnoncesPF(filters = {}) {
  console.log('🔍 Scraping PetitesAnnonces.pf avec scraper amélioré...');
  
  try {
    // Les 8 catégories immobilières
    const urls = [
      'https://www.petites-annonces.pf/annonces.php?c=1', // Vente maison
      'https://www.petites-annonces.pf/annonces.php?c=2', // Vente appartement
      'https://www.petites-annonces.pf/annonces.php?c=3', // Vente terrain
      'https://www.petites-annonces.pf/annonces.php?c=4', // Vente commercial
      'https://www.petites-annonces.pf/annonces.php?c=5', // Location maison
      'https://www.petites-annonces.pf/annonces.php?c=6', // Location appartement
      'https://www.petites-annonces.pf/annonces.php?c=7', // Location bureau
      'https://www.petites-annonces.pf/annonces.php?c=8', // Location commercial
    ];
    
    const allListings = [];
    
    // Scraper chaque catégorie
    for (const url of urls) {
      try {
        console.log(`  📥 ${url}...`);
        
        const response = await axios.get(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'fr-FR,fr;q=0.9',
          },
          timeout: 15000
        });
        
        const $ = cheerio.load(response.data);
        
        // MÉTHODE 1: Chercher les tables (structure classique)
        let found = false;
        
        // Essayer les lignes de tableau
        $('tr').each((index, element) => {
          try {
            const $row = $(element);
            const rowText = $row.text();
            
            // Chercher les prix (indicateur d'annonce)
            const priceMatch = rowText.match(/([\d\s]+)\s*XPF/);
            if (!priceMatch) return;
            
            const price = parseInt(priceMatch[1].replace(/\s/g, ''));
            if (price < 50000 || price > 1000000000) return; // Filtrer prix aberrants
            
            // Extraire le lien
            const link = $row.find('a').first();
            const href = link.attr('href') || '';
            const detailUrl = href ? (href.startsWith('http') ? href : `https://www.petites-annonces.pf/${href}`) : '';
            
            // Extraire le titre (texte du lien ou premier texte significatif)
            let title = link.text().trim();
            if (!title || title.length < 5) {
              // Chercher dans tous les td
              $row.find('td').each((i, td) => {
                const text = $(td).text().trim();
                if (text.length > 10 && text.length < 200 && !text.includes('XPF') && !title) {
                  title = text;
                }
              });
            }
            
            // Si toujours pas de titre, utiliser une partie du texte
            if (!title || title.length < 5) {
              const lines = rowText.split('\n').map(l => l.trim()).filter(l => l.length > 10 && l.length < 200);
              title = lines[0] || rowText.substring(0, 100);
            }
            
            // Extraire l'image
            const img = $row.find('img').first();
            let imageUrl = img.attr('src') || img.attr('data-src') || '';
            if (imageUrl && !imageUrl.startsWith('http')) {
              imageUrl = imageUrl.startsWith('/') 
                ? `https://www.petites-annonces.pf${imageUrl}`
                : `https://www.petites-annonces.pf/${imageUrl}`;
            }
            
            // Extraire localisation
            const locationMatch = rowText.match(/(?:à|À|Commune|Ville)\s*:?\s*([A-ZÉÈÊÀ][a-zéèêàâù]+(?:\s+[A-ZÉÈÊÀ][a-zéèêàâù]+)?)/);
            const location = locationMatch ? locationMatch[1] : 'Tahiti';
            
            // Type de transaction (déterminer depuis l'URL)
            const categoryNum = parseInt(url.match(/c=(\d)/)?.[1] || '0');
            const transactionType = categoryNum >= 5 ? 'rent' : 'sale';
            
            // Type de bien
            let propertyType = 'Maison';
            const lowerTitle = title.toLowerCase();
            if (lowerTitle.includes('appartement') || lowerTitle.includes('f2') || lowerTitle.includes('f3')) {
              propertyType = 'Appartement';
            } else if (lowerTitle.includes('villa')) {
              propertyType = 'Villa';
            } else if (lowerTitle.includes('terrain')) {
              propertyType = 'Terrain';
            } else if (lowerTitle.includes('commercial') || lowerTitle.includes('bureau') || lowerTitle.includes('local')) {
              propertyType = 'Commercial';
            }
            
            // Surface
            let surface = 0;
            const surfaceMatch = rowText.match(/(\d+)\s*m[²2]/i);
            if (surfaceMatch) surface = parseInt(surfaceMatch[1]);
            
            // Pièces
            let rooms = 0;
            const roomMatch = rowText.match(/(\d+)\s*(?:pièces?|chambres?|P\b|F\d)/i);
            if (roomMatch) rooms = parseInt(roomMatch[1]);
            
            // Caractéristiques
            const features = [];
            const lowerText = rowText.toLowerCase();
            if (lowerText.includes('jardin')) features.push('garden');
            if (lowerText.includes('terrasse')) features.push('terrace');
            if (lowerText.includes('balcon')) features.push('balcony');
            if (lowerText.includes('garage')) features.push('garage');
            if (lowerText.includes('piscine')) features.push('pool');
            if (lowerText.includes('meublé')) features.push('furnished');
            if (lowerText.includes('climatisation') || lowerText.includes('clim')) features.push('aircon');
            if (lowerText.includes('vue mer')) features.push('seaview');
            
            // Description
            let description = '';
            $row.find('td').each((i, td) => {
              const text = $(td).text().trim();
              if (text.length > 50 && text.length < 500 && !description) {
                description = text;
              }
            });
            
            // Créer l'annonce
            if (title && price && title.length > 5) {
              allListings.push({
                id: `pa-${Date.now()}-${allListings.length}`,
                source: 'petitesannonces-pf',
                sourceName: 'PetitesAnnonces.pf',
                sourceColor: '#F97316',
                title: title.substring(0, 200),
                price,
                priceText: `${price.toLocaleString('fr-FR')} XPF`,
                priceNormalized: price,
                location: location.substring(0, 50),
                surface,
                rooms,
                propertyType,
                type: propertyType,
                transactionType,
                features,
                imageUrl: imageUrl || `https://via.placeholder.com/800x600/e5e7eb/9ca3af?text=${encodeURIComponent(propertyType)}`,
                url: detailUrl,
                description: description.substring(0, 300) || title,
                dateAdded: new Date().toISOString(),
              });
              
              found = true;
            }
          } catch (err) {
            // Ignorer erreurs individuelles
          }
        });
        
        // MÉTHODE 2: Chercher les divs/articles si aucune table trouvée
        if (!found) {
          $('div, article, section').each((index, element) => {
            try {
              const $el = $(element);
              const text = $el.text();
              
              // Chercher prix
              const priceMatch = text.match(/([\d\s]+)\s*XPF/);
              if (!priceMatch) return;
              
              const price = parseInt(priceMatch[1].replace(/\s/g, ''));
              if (price < 50000 || price > 1000000000) return;
              
              // Si cet élément contient d'autres éléments avec prix, ignorer (c'est un container)
              if ($el.find('*').filter((i, child) => $(child).text().includes('XPF')).length > 1) return;
              
              const link = $el.find('a').first();
              const href = link.attr('href') || '';
              const detailUrl = href ? (href.startsWith('http') ? href : `https://www.petites-annonces.pf/${href}`) : '';
              
              let title = link.text().trim() || $el.find('h1, h2, h3, h4, h5, strong').first().text().trim();
              if (!title || title.length < 5) {
                const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 10 && l.length < 200);
                title = lines[0] || text.substring(0, 100);
              }
              
              const img = $el.find('img').first();
              let imageUrl = img.attr('src') || img.attr('data-src') || '';
              if (imageUrl && !imageUrl.startsWith('http')) {
                imageUrl = imageUrl.startsWith('/') 
                  ? `https://www.petites-annonces.pf${imageUrl}`
                  : `https://www.petites-annonces.pf/${imageUrl}`;
              }
              
              const locationMatch = text.match(/(?:à|À|Commune|Ville)\s*:?\s*([A-ZÉÈÊÀ][a-zéèêàâù]+)/);
              const location = locationMatch ? locationMatch[1] : 'Tahiti';
              
              const categoryNum = parseInt(url.match(/c=(\d)/)?.[1] || '0');
              const transactionType = categoryNum >= 5 ? 'rent' : 'sale';
              
              let propertyType = 'Maison';
              const lowerTitle = title.toLowerCase();
              if (lowerTitle.includes('appartement')) propertyType = 'Appartement';
              else if (lowerTitle.includes('villa')) propertyType = 'Villa';
              else if (lowerTitle.includes('terrain')) propertyType = 'Terrain';
              else if (lowerTitle.includes('commercial')) propertyType = 'Commercial';
              
              if (title && price && title.length > 5) {
                allListings.push({
                  id: `pa-${Date.now()}-${allListings.length}`,
                  source: 'petitesannonces-pf',
                  sourceName: 'PetitesAnnonces.pf',
                  sourceColor: '#F97316',
                  title: title.substring(0, 200),
                  price,
                  priceText: `${price.toLocaleString('fr-FR')} XPF`,
                  priceNormalized: price,
                  location,
                  surface: 0,
                  rooms: 0,
                  propertyType,
                  type: propertyType,
                  transactionType,
                  features: [],
                  imageUrl: imageUrl || `https://via.placeholder.com/800x600/e5e7eb/9ca3af?text=${encodeURIComponent(propertyType)}`,
                  url: detailUrl,
                  description: text.substring(0, 300),
                  dateAdded: new Date().toISOString(),
                });
              }
            } catch (err) {
              // Ignorer
            }
          });
        }
        
        console.log(`    ✓ ${allListings.length} annonces jusqu'ici`);
        
      } catch (err) {
        console.error(`  ❌ Erreur ${url}:`, err.message);
      }
    }
    
    // Dédupliquer par URL
    const uniqueListings = [];
    const seenUrls = new Set();
    
    for (const listing of allListings) {
      const key = listing.url || `${listing.title}-${listing.price}`;
      if (!seenUrls.has(key)) {
        seenUrls.add(key);
        uniqueListings.push(listing);
      }
    }
    
    console.log(`✅ Total: ${uniqueListings.length} annonces uniques`);
    return uniqueListings;
    
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
    message: 'ImmoSearch PF API - Scraper amélioré',
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
  console.log('\n🏝️ ImmoSearch PF - Backend amélioré');
  console.log(`🚀 Port ${PORT}`);
  console.log(`📍 API: http://localhost:${PORT}/api/search\n`);
});

module.exports = app;
