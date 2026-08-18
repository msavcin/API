#!/usr/bin/env node
require('dotenv').config();
const { GoogleSearch } = require('google-search-results-nodejs');
const path = require('path');
const fs = require('fs');

(async function(){
  const key = process.env.SERPAPI_KEY;
  if (!key) {
    console.error('[testSerpApi] SERPAPI_KEY not set in environment or .env');
    process.exit(1);
  }

  const search = new GoogleSearch(key);
  const q = process.argv.slice(2).join(' ') || 'Turkey Boxing Federation Campground 41.27483330, 33.78353530 camping reviews';
  const params = {
    engine: 'google',
    q,
    hl: 'tr',
    gl: 'tr',
    num: 10,
  };

  console.log('[testSerpApi] Query:', q);

  try {
    await new Promise((resolve, reject) => {
      search.json(params, (data) => {
        if (!data) return reject(new Error('No data returned from SerpAPI'));

        try {
          console.log('[testSerpApi] Top-level keys:', Object.keys(data).join(', '));

          if (data.answer_box) {
            console.log('[testSerpApi] answer_box snippet:', data.answer_box.snippet || data.answer_box.answer || JSON.stringify(data.answer_box).slice(0,300));
          }

          if (data.knowledge_graph) {
            console.log('[testSerpApi] knowledge_graph.description:', data.knowledge_graph.description || '---');
          }

          if (Array.isArray(data.organic_results) && data.organic_results.length) {
            console.log('[testSerpApi] first organic result:', data.organic_results[0].title || 'no-title', data.organic_results[0].link || data.organic_results[0].formatted_url || 'no-link');
          }

          if (Array.isArray(data.related_questions) && data.related_questions.length) {
            console.log('[testSerpApi] related_questions:', data.related_questions.slice(0,3).map(r => r.question).join(' | '));
          }

          const outDir = path.join(__dirname, '..', 'tmp');
          if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
          const outPath = path.join(outDir, 'serpapi-response.json');
          fs.writeFileSync(outPath, JSON.stringify(data, null, 2), 'utf8');
          console.log('[testSerpApi] Full response written to', outPath);

          resolve();
        } catch (err) {
          reject(err);
        }
      });
    });
  } catch (err) {
    console.error('[testSerpApi] Error:', err.message);
    process.exit(1);
  }
})();
