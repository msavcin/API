#!/usr/bin/env node
require('dotenv').config();
const { fetchGoogleAIOverview, formatAIOverviewForPrompt } = require('../src/services/googleAIOverviewService');

(async function(){
  const campName = process.argv.slice(2).join(' ') || 'Cennet Dalan Koyu';
  const location = '10400 Ayvalık/Balıkesir';

  console.log('[Test] Fetching AI Overview for:', campName);
  console.log('[Test] Location:', location);
  console.log('');

  try {
    const result = await fetchGoogleAIOverview(campName, location);
    
    console.log('=== RAW RESULT ===');
    console.log(JSON.stringify(result, null, 2));
    console.log('');
    
    console.log('=== FORMATTED FOR PROMPT ===');
    const formatted = formatAIOverviewForPrompt(result);
    console.log(formatted);
    console.log('');
    
    console.log('=== STATS ===');
    console.log('AI Overview length:', result.aiOverview?.length || 0, 'chars');
    console.log('Related questions:', result.relatedQuestions?.length || 0);
    
  } catch (err) {
    console.error('[Test] Error:', err.message);
    process.exit(1);
  }
})();
