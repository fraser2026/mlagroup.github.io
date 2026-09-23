/**

 * Frontier provider + model catalog for AI asset onboarding.

 * Registry taxonomy: provider (Anthropic) → model (Claude …).

 * Model list is client-side so it can update without a migration.

 * Updated September 2026.

 */

(function (global) {

  var OTHER_MODEL = { id: 'other', label: 'Other (specify in notes)' };



  var MODELS = {

    anthropic: [

      { id: 'claude-fable-5-1', label: 'Claude Fable 5.1' },

      { id: 'claude-opus-5', label: 'Claude Opus 5' },

      { id: 'claude-sonnet-5', label: 'Claude Sonnet 5' },

      { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },

      { id: 'claude-opus-4-8', label: 'Claude Opus 4.8' },

      OTHER_MODEL

    ],

    openai: [

      { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol' },

      { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra' },

      { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna' },

      { id: 'gpt-5.4-pro', label: 'GPT-5.4 Pro' },

      OTHER_MODEL

    ],

    google: [

      { id: 'gemini-3.1-pro', label: 'Gemini 3.1 Pro' },

      { id: 'gemini-3.0-pro', label: 'Gemini 3.0 Pro' },

      { id: 'gemini-3.0-flash', label: 'Gemini 3.0 Flash' },

      OTHER_MODEL

    ],

    bedrock: [

      { id: 'anthropic.claude-opus-5', label: 'Claude Opus 5 (Bedrock)' },

      { id: 'anthropic.claude-sonnet-5', label: 'Claude Sonnet 5 (Bedrock)' },

      { id: 'anthropic.claude-fable-5-1', label: 'Claude Fable 5.1 (Bedrock)' },

      { id: 'amazon.nova-2-pro', label: 'Amazon Nova 2 Pro' },

      { id: 'meta.llama-4-70b', label: 'Meta Llama 4 70B' },

      OTHER_MODEL

    ],

    azure: [

      { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol (Azure OpenAI)' },

      { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra (Azure OpenAI)' },

      OTHER_MODEL

    ],

    in_house: [

      { id: 'custom', label: 'Custom / proprietary model' },

      { id: 'not_applicable', label: 'Not applicable' }

    ],

    other: [

      OTHER_MODEL

    ]

  };



  function modelsForPlatform(slug) {

    return MODELS[slug] || [];

  }



  function modelLabel(platformSlug, modelId) {

    if (!modelId) return '';

    if (modelId === 'other') return OTHER_MODEL.label;

    var list = modelsForPlatform(platformSlug);

    var row = list.find(function (m) { return m.id === modelId; });

    return row ? row.label : modelId;

  }



  function deriveSystemType(platformSlug, vendor) {

    if (platformSlug === 'in_house') return 'in_house';

    if (vendor) return 'third_party';

    return 'in_house';

  }



  function notesRequired(platformSlug, modelId) {

    return platformSlug === 'other' || modelId === 'other';

  }



  global.RA_ASSET_TECH = {

    modelsForPlatform: modelsForPlatform,

    modelLabel: modelLabel,

    deriveSystemType: deriveSystemType,

    notesRequired: notesRequired

  };

})(typeof window !== 'undefined' ? window : globalThis);

