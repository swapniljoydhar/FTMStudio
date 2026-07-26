// ===========================================================================
// content/constants.js — Centralized constants and extension maps
// ===========================================================================

window.FTM = window.FTM || {};

FTM.CONSTANTS = {
  SNIFF_THRESHOLD_BYTES: 1024,
  MAX_TEXT_READ_SIZE_BYTES: 10 * 1024 * 1024,
  MAX_FILE_SIZE_BYTES: 50 * 1024 * 1024,
  CSV_STREAM_THRESHOLD_MB_DEFAULT: 5,
  MAX_CSV_ROWS: 100000,
  SCRIPT_LOAD_TIMEOUT_MS: 15000,
  CONVERSION_TIMEOUT_MS: 60000,
  TOAST_COUNTDOWN_DEFAULT_SEC: 10,
  MAX_HISTORY_ENTRIES: 50,
  KB: 1024,
  MB: 1024 * 1024
};

FTM.EXTENSION_MAP = {
  '.docx': 'documents', '.txt': 'documents', '.rtf': 'documents', '.md': 'documents',
  '.pdf': 'pdf',
  '.csv': 'spreadsheets', '.xlsx': 'spreadsheets', '.xls': 'spreadsheets',
  '.py': 'code', '.js': 'code', '.cpp': 'code', '.css': 'code', '.json': 'code', '.xml': 'code',
  '.html': 'markup', '.epub': 'markup',
  '.pptx': 'presentations'
};

FTM.TEXT_EXTENSIONS = new Set(['.txt', '.md', '.py', '.js', '.cpp', '.css', '.json', '.xml', '.html', '.csv']);
FTM.BINARY_EXTENSIONS = new Set(['.docx', '.xlsx', '.xls', '.epub', '.pptx', '.pdf']);
FTM.RTF_EXTENSION = new Set(['.rtf']);

FTM.MAGIC_SIGNATURES = [
  { bytes: [0x50, 0x4B, 0x03, 0x04], name: 'ZIP/DOCX/XLSX/PPTX/EPUB' },
  { bytes: [0x25, 0x50, 0x44, 0x46], name: 'PDF' },
  { bytes: [0xD0, 0xCF, 0x11, 0xE0], name: 'OLE2 (legacy DOC/XLS)' },
  { bytes: [0x7B, 0x5C, 0x72, 0x74, 0x66], name: 'RTF' },
  { bytes: [0x1F, 0x8B], name: 'GZIP' },
  { bytes: [0x42, 0x5A, 0x68], name: 'BZIP2' },
];

// AI/LLM platforms where Smart Mode activates automatically
// Grouped by category for maintainability
FTM.AI_HOSTS = [
  // ── LLM Chatbots ──
  'chat.openai.com', 'chatgpt.com', 'platform.openai.com',
  'claude.ai', 'console.anthropic.com', 'chat.qwen.ai',
  'gemini.google.com', 'bard.google.com', 'aistudio.google.com',
  'copilot.microsoft.com', 'bing.com', 'chat.deepseek.com',
  'chat.deepseek.com', 'deepseek.com',
  'chat.mistral.ai', 'mistral.ai',
  'huggingface.co', 'hf.co',
  'poe.com',
  'perplexity.ai', 'labs.perplexity.ai',
  'you.com',
  'character.ai',
  'meta.ai', 'llama.meta.com',
  'cohere.com', 'dashboard.cohere.com',
  'chatglm.cn', 'chat.zhipuai.cn',
  'tongyi.aliyun.com', 'qianwen.aliyun.com',
  'kimi.moonshot.cn', 'moonshot.cn',
  'doubao.com',
  'yiyan.baidu.com', 'cloud.baidu.com',
  'iflytek.com', 'xinghuo.xfyun.cn',
  'minimax.chat', 'minimaxi.com',
  '01.ai', 'wanmo.ai',
  'abab.minimaxi.com',
  'reka.ai',
  'labs.google',
  'pi.ai',
  'inflection.ai',
  'groq.com',
  'together.ai',
  'fireworks.ai',
  'anyscale.com',
  'replicate.com',
  'openrouter.ai',

  // ── AI Writing & Copy ──
  'jasper.ai', 'app.jasper.ai',
  'copy.ai',
  'writesonic.com', 'chatsonic.com',
  'rytr.me',
  'sudowrite.com',
  'shortlyai.com',
  'copysmith.ai',
  'anyword.com',
  'wordtune.com',
  'compose.ai',
  'hyperwriteai.com',
  'moonbeam.ai',
  'textcortex.com',
  'peppertype.ai',
  'simplified.com',
  'scalenut.com',
  'frase.io',
  'surfer-seo.com',
  'neuronwriter.com',
  'growthbar-seo.com',
  'outwrite.com',
  'grammarly.com',
  'prowritingaid.com',
  'quillbot.com',
  'undetectable.ai',
  'gptzero.me',
  'zerogpt.com',
  'copyleaks.com',

  // ── AI Code ──
  'cursor.sh', 'cursor.com',
  'replit.com',
  'codeium.com',
  'tabnine.com',
  'codiga.io',
  'sourcery.ai',
  'deepcode.ai',
  'askcodi.com',
  'blackbox.ai',
  'phind.com',
  'devv.ai',
  'codegeex.cn',
  'seek.ai',
  'mutable.ai',

  // ── AI Image Generation ──
  'midjourney.com',
  'stability.ai', 'dreamstudio.ai',
  'leonardo.ai',
  'ideogram.ai',
  'playground.ai',
  'craiyon.com',
  'imagine.meta.com',
  'firefly.adobe.com',
  'canva.com',
  'picsart.com',
  'remove.bg',
  'upscayl.org',
  'lensa.ai',
  'wombo.art',
  'nightcafe.studio',
  'artbreeder.com',
  'getimg.ai',
  'stablediffusionweb.com',
  'clipdrop.co',
  'dezgo.com',
  'hotpot.ai',
  'deepai.org',

  // ── AI Video ──
  'runwayml.com', 'runway.com',
  'synthesia.io',
  'pika.art',
  'klingai.com',
  'luma.ai',
  'heygen.com',
  'descript.com',
  'kapwing.com',
  'invideo.io',
  'pictory.ai',
  'elai.io',
  'colossyan.com',
  'hourone.ai',
  'rephrase.ai',
  'd-id.com',
  'kaiber.ai',
  'genmo.ai',

  // ── AI Audio & Voice ──
  'elevenlabs.io',
  'play.ht',
  'murf.ai',
  'resemble.ai',
  'speechify.com',
  'otter.ai',
  'fireflies.ai',
  'voicemod.net',
  'uberduck.ai',
  'suno.com',
  'udio.com',
  'aiva.ai',
  'soundraw.io',
  'mubert.com',
  'boomy.com',

  // ── AI Search & Research ──
  'consensus.app',
  'elicit.com',
  'scite.ai',
  'semanticscholar.org',
  'typeset.io',
  'chatpdf.com',
  'explainpaper.com',

  // ── AI Productivity & Business ──
  'notion.so', 'notion.ai',
  'gamma.app',
  'tome.app',
  'beautiful.ai',
  'slidesai.io',
  'taskade.com',
  'mem.ai',
  'read.ai',
  'fathom.video',
  'tldv.io',
  'gong.io',
  'chorus.ai',
  'intercom.com',
  'drift.com',
  'zendesk.com',
  'freshdesk.com',
  'tidio.com',
  'crisp.chat',
  'liveperson.com',
  'ada.cx',
  'forethought.ai',

  // ── AI Data & Analytics ──
  'databricks.com',
  'h2o.ai',
  'dataiku.com',
  'alteryx.com',
  'obviously.ai',
  'monkeylearn.com',

  // ── AI Design ──
  'figma.com',
  'uizard.io',
  'galileo.ai',
  'magician.design',
  'whimsical.com',
  'miro.com',

  // ── AI Education ──
  'duolingo.com',
  'quizlet.com',
  'photomath.com',
  'gradescope.com',

  // ── AI Legal & Finance ──
  'harvey.ai',
  'alphasense.com',
  'kensho.com',

  // ── AI Health ──
  'tempus.com',
  'pathai.com',
  'viz.ai',
  'aidoc.com',
  'benevolent.ai',
  'recursionpharma.com',
  'insitro.com',
];
