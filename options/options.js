// Options page script for TextLens AI v2
document.addEventListener('DOMContentLoaded', function() {
  // Elements
  const apiProviderSelect = document.getElementById('apiProvider');
  const groqSettings = document.getElementById('groqSettings');
  const geminiSettings = document.getElementById('geminiSettings');
  const groqApiKeyInput = document.getElementById('groqApiKey');
  const geminiApiKeyInput = document.getElementById('geminiApiKey');
  const ocrLanguageSelect = document.getElementById('ocrLanguage');
  const ocrQualitySelect = document.getElementById('ocrQuality');
  const defaultActionSelect = document.getElementById('defaultAction');
  const saveHistoryCheckbox = document.getElementById('saveHistory');
  const historyLimitSelect = document.getElementById('historyLimit');
  const customPromptsContainer = document.querySelector('.custom-prompts');
  const addCustomPromptBtn = document.getElementById('addCustomPrompt');
  const clearAllDataBtn = document.getElementById('clearAllData');
  const resetSettingsBtn = document.getElementById('resetSettings');
  const saveSettingsBtn = document.getElementById('saveSettings');
  const statusElement = document.getElementById('status');

  let customPrompts = [];

  // Initialize
  init();

  async function init() {
    await loadSettings();
    setupEventListeners();
  }

  // Load settings from storage
  async function loadSettings() {
    try {
      const settings = await chrome.storage.local.get([
        'apiProvider',
        'groqApiKey',
        'geminiApiKey',
        'ocrLanguage',
        'ocrQuality',
        'defaultAction',
        'saveHistory',
        'historyLimit',
        'customPrompts'
      ]);

      // API Provider
      if (settings.apiProvider) {
        apiProviderSelect.value = settings.apiProvider;
        toggleApiSettings(settings.apiProvider);
      }

      // API Keys
      if (settings.groqApiKey) {
        groqApiKeyInput.value = settings.groqApiKey;
      }
      if (settings.geminiApiKey) {
        geminiApiKeyInput.value = settings.geminiApiKey;
      }

      // OCR Settings
      if (settings.ocrLanguage) {
        ocrLanguageSelect.value = settings.ocrLanguage;
      }
      if (settings.ocrQuality) {
        ocrQualitySelect.value = settings.ocrQuality;
      }

      // Default Action
      if (settings.defaultAction) {
        defaultActionSelect.value = settings.defaultAction;
      }

      // Privacy Settings
      saveHistoryCheckbox.checked = settings.saveHistory !== false; // Default to true
      if (settings.historyLimit) {
        historyLimitSelect.value = settings.historyLimit;
      }

      // Custom Prompts
      if (settings.customPrompts) {
        customPrompts = settings.customPrompts;
        renderCustomPrompts();
      }

    } catch (error) {
      console.error('Error loading settings:', error);
      showStatus('Error loading settings', 'error');
    }
  }

  // Setup event listeners
  function setupEventListeners() {
    // API Provider change
    apiProviderSelect.addEventListener('change', (e) => {
      toggleApiSettings(e.target.value);
    });

    // Custom prompts
    addCustomPromptBtn.addEventListener('click', addCustomPrompt);

    // Action buttons
    saveSettingsBtn.addEventListener('click', saveSettings);
    resetSettingsBtn.addEventListener('click', resetSettings);
    clearAllDataBtn.addEventListener('click', clearAllData);
  }

  // Toggle API settings visibility
  function toggleApiSettings(provider) {
    if (provider === 'groq') {
      groqSettings.style.display = 'block';
      geminiSettings.style.display = 'none';
    } else {
      groqSettings.style.display = 'none';
      geminiSettings.style.display = 'block';
    }
  }

  // Custom prompts management
  function addCustomPrompt() {
    customPrompts.push({
      id: Date.now(),
      name: '',
      prompt: ''
    });
    renderCustomPrompts();
  }

  function removeCustomPrompt(id) {
    customPrompts = customPrompts.filter(prompt => prompt.id !== id);
    renderCustomPrompts();
  }

  function renderCustomPrompts() {
    customPromptsContainer.innerHTML = '';
    
    customPrompts.forEach(prompt => {
      const promptItem = document.createElement('div');
      promptItem.className = 'custom-prompt-item';
      
      promptItem.innerHTML = `
        <input type="text" placeholder="Prompt name" class="prompt-name" value="${prompt.name}">
        <textarea placeholder="Enter your custom prompt..." class="prompt-text">${prompt.prompt}</textarea>
        <button class="btn-remove" data-id="${prompt.id}">Remove</button>
      `;
      
      // Add event listeners
      const nameInput = promptItem.querySelector('.prompt-name');
      const promptTextarea = promptItem.querySelector('.prompt-text');
      const removeBtn = promptItem.querySelector('.btn-remove');
      
      nameInput.addEventListener('input', (e) => {
        const promptObj = customPrompts.find(p => p.id === prompt.id);
        if (promptObj) promptObj.name = e.target.value;
      });
      
      promptTextarea.addEventListener('input', (e) => {
        const promptObj = customPrompts.find(p => p.id === prompt.id);
        if (promptObj) promptObj.prompt = e.target.value;
      });
      
      removeBtn.addEventListener('click', () => {
        removeCustomPrompt(prompt.id);
      });
      
      customPromptsContainer.appendChild(promptItem);
    });
  }

  // Save settings
  async function saveSettings() {
    try {
      const apiProvider = apiProviderSelect.value;
      const requiredKey = apiProvider === 'groq' ? groqApiKeyInput.value.trim() : geminiApiKeyInput.value.trim();
      
      if (!requiredKey) {
        showStatus(`Please enter a valid ${apiProvider === 'groq' ? 'Groq' : 'Gemini'} API key`, 'error');
        return;
      }

      const settings = {
        apiProvider: apiProvider,
        groqApiKey: groqApiKeyInput.value.trim(),
        geminiApiKey: geminiApiKeyInput.value.trim(),
        ocrLanguage: ocrLanguageSelect.value,
        ocrQuality: parseInt(ocrQualitySelect.value),
        defaultAction: defaultActionSelect.value,
        saveHistory: saveHistoryCheckbox.checked,
        historyLimit: parseInt(historyLimitSelect.value),
        customPrompts: customPrompts.filter(p => p.name && p.prompt)
      };

      await chrome.storage.local.set(settings);
      showStatus('Settings saved successfully!', 'success');

    } catch (error) {
      console.error('Error saving settings:', error);
      showStatus('Error saving settings', 'error');
    }
  }

  // Reset settings to defaults
  async function resetSettings() {
    if (!confirm('Are you sure you want to reset all settings to defaults? This cannot be undone.')) {
      return;
    }

    try {
      // Clear all settings
      await chrome.storage.local.clear();
      
      // Reset form to defaults
      apiProviderSelect.value = 'groq';
      toggleApiSettings('groq');
      groqApiKeyInput.value = '';
      geminiApiKeyInput.value = '';
      ocrLanguageSelect.value = 'eng';
      ocrQualitySelect.value = '2';
      defaultActionSelect.value = 'analyze';
      saveHistoryCheckbox.checked = true;
      historyLimitSelect.value = '50';
      
      customPrompts = [];
      renderCustomPrompts();
      
      showStatus('Settings reset to defaults', 'success');

    } catch (error) {
      console.error('Error resetting settings:', error);
      showStatus('Error resetting settings', 'error');
    }
  }

  // Clear all data
  async function clearAllData() {
    const confirmText = 'DELETE';
    const userInput = prompt(
      `This will permanently delete ALL extension data including:\n\n` +
      `• All settings and configuration\n` +
      `• Capture history\n` +
      `• Chat conversations\n` +
      `• Custom prompts\n\n` +
      `Type "${confirmText}" to confirm:`
    );

    if (userInput !== confirmText) {
      return;
    }

    try {
      // Clear all storage
      await chrome.storage.local.clear();
      
      // Reset form
      await resetSettings();
      
      showStatus('All data cleared successfully', 'success');

    } catch (error) {
      console.error('Error clearing data:', error);
      showStatus('Error clearing data', 'error');
    }
  }

  // Show status message
  function showStatus(message, type) {
    statusElement.textContent = message;
    statusElement.className = `status ${type} show`;
    
    setTimeout(() => {
      statusElement.classList.remove('show');
    }, 3000);
  }
});