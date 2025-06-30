// Popup script for TextLens AI v2
document.addEventListener('DOMContentLoaded', function() {
  // Elements
  const navTabs = document.querySelectorAll('.nav-tab');
  const tabPanels = document.querySelectorAll('.tab-panel');
  const actionBtns = document.querySelectorAll('.action-btn');
  const startSelectionBtn = document.getElementById('startSelection');
  const settingsBtn = document.getElementById('settings');
  const statusElement = document.getElementById('status');
  const loadingSpinner = document.getElementById('loadingSpinner');
  const resultSection = document.getElementById('resultSection');
  const textContent = document.getElementById('textContent');
  const analysisContent = document.getElementById('analysisContent');
  const copyResultBtn = document.getElementById('copyResult');
  const clearResultBtn = document.getElementById('clearResult');
  const chatInput = document.getElementById('chatInput');
  const sendMessageBtn = document.getElementById('sendMessage');
  const chatMessages = document.getElementById('chatMessages');
  const historyList = document.getElementById('historyList');
  const clearHistoryBtn = document.getElementById('clearHistory');

  let currentAction = 'analyze';
  let lastExtractedText = '';

  // Initialize popup
  init();

  async function init() {
    // Load settings
    await loadSettings();
    
    // Check for existing results
    try {
      const response = await chrome.runtime.sendMessage({ type: 'getResult' });
      
      if (response.isProcessing) {
        showLoading();
        pollForResults();
      } else if (response.result) {
        if (response.result.error) {
          showStatus(response.result.error, 'error');
        } else {
          showResult(response.result);
          lastExtractedText = response.result.extractedText;
        }
      }
    } catch (error) {
      console.log('Error getting initial result:', error);
    }

    // Load history and conversation
    loadHistory();
    loadConversation();
    
    // Check API configuration
    checkApiConfiguration();
  }

  // Tab navigation
  navTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const targetTab = tab.dataset.tab;
      switchTab(targetTab);
    });
  });

  function switchTab(tabName) {
    navTabs.forEach(tab => {
      tab.classList.toggle('active', tab.dataset.tab === tabName);
    });
    
    tabPanels.forEach(panel => {
      panel.classList.toggle('active', panel.id === `${tabName}Panel`);
    });

    // Load data for specific tabs
    if (tabName === 'history') {
      loadHistory();
    } else if (tabName === 'chat') {
      loadConversation();
    }
  }

  // Quick actions
  actionBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      actionBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentAction = btn.dataset.action;
      
      // Save default action
      chrome.storage.local.set({ defaultAction: currentAction });
    });
  });

  // Load settings
  async function loadSettings() {
    try {
      const settings = await chrome.storage.local.get(['defaultAction']);
      if (settings.defaultAction) {
        currentAction = settings.defaultAction;
        const actionBtn = document.querySelector(`[data-action="${currentAction}"]`);
        if (actionBtn) {
          actionBtns.forEach(b => b.classList.remove('active'));
          actionBtn.classList.add('active');
        }
      }
    } catch (error) {
      console.log('Error loading settings:', error);
    }
  }

  // Check API configuration
  async function checkApiConfiguration() {
    try {
      const settings = await chrome.storage.local.get(['groqApiKey', 'geminiApiKey', 'apiProvider']);
      const provider = settings.apiProvider || 'groq';
      const hasKey = provider === 'groq' ? settings.groqApiKey : settings.geminiApiKey;
      
      if (!hasKey) {
        showStatus(`Please configure your ${provider === 'groq' ? 'Groq' : 'Gemini'} API key in settings`, 'warning');
      }
    } catch (error) {
      console.log('Error checking API configuration:', error);
    }
  }

  // Start selection
  startSelectionBtn.addEventListener('click', async () => {
    try {
      hideAll();
      showStatus('Preparing selection mode...', 'success');
      
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      if (!tab) {
        throw new Error('No active tab found');
      }

      if (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://') || tab.url.startsWith('moz-extension://')) {
        throw new Error('Cannot access this type of page. Please try on a regular webpage.');
      }
      
      await chrome.runtime.sendMessage({ type: 'clearResult' });
      
      // Test content script
      let contentScriptLoaded = false;
      try {
        await chrome.tabs.sendMessage(tab.id, { type: 'ping' });
        contentScriptLoaded = true;
      } catch (e) {
        console.log('Content script not loaded, will inject');
      }
      
      if (!contentScriptLoaded) {
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content.js']
          });
          
          await new Promise(resolve => setTimeout(resolve, 500));
          
        } catch (injectionError) {
          console.error('Error injecting content script:', injectionError);
          throw new Error('Failed to inject content script. Please refresh the page and try again.');
        }
      }
      
      // Send message with retry logic
      let attempts = 0;
      const maxAttempts = 3;
      
      while (attempts < maxAttempts) {
        try {
          await chrome.tabs.sendMessage(tab.id, { type: 'initSelection' });
          break;
        } catch (error) {
          attempts++;
          if (attempts >= maxAttempts) {
            throw new Error('Failed to communicate with page. Please refresh and try again.');
          }
          await new Promise(resolve => setTimeout(resolve, 300));
        }
      }
      
      showStatus('Click and drag to select text area on the page', 'success');
      
      setTimeout(() => {
        window.close();
      }, 1500);
      
    } catch (error) {
      console.error('Error starting selection:', error);
      showStatus('Error: ' + error.message, 'error');
    }
  });

  // Copy result
  copyResultBtn.addEventListener('click', async () => {
    try {
      const fullText = `Extracted Text:\n${textContent.textContent}\n\nAI Analysis:\n${analysisContent.textContent}`;
      await navigator.clipboard.writeText(fullText);
      showStatus('Results copied to clipboard!', 'success');
    } catch (error) {
      showStatus('Failed to copy to clipboard', 'error');
    }
  });

  // Clear result
  clearResultBtn.addEventListener('click', async () => {
    try {
      await chrome.runtime.sendMessage({ type: 'clearResult' });
      hideAll();
      showStatus('Results cleared', 'success');
      lastExtractedText = '';
    } catch (error) {
      showStatus('Error clearing results', 'error');
    }
  });

  // Chat functionality
  chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  sendMessageBtn.addEventListener('click', sendMessage);

  async function sendMessage() {
    const message = chatInput.value.trim();
    if (!message) return;

    // Add user message to chat
    addChatMessage(message, 'user');
    chatInput.value = '';

    try {
      // Send message to background
      const response = await chrome.runtime.sendMessage({
        type: 'sendMessage',
        data: {
          message: message,
          context: lastExtractedText
        }
      });

      if (response.success) {
        addChatMessage(response.response, 'assistant');
      } else {
        addChatMessage('Error: ' + response.error, 'assistant');
      }
    } catch (error) {
      addChatMessage('Error: Failed to send message', 'assistant');
    }
  }

 function addChatMessage(content, role) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `chat-message ${role}`;
    
    // Remove markdown formatting for clean text display
    const cleanContent = markdownToPlainText(content);
    messageDiv.textContent = cleanContent;
    
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  // Function to convert markdown to plain text
  function markdownToPlainText(markdown) {
    if (!markdown) return '';
    
    let text = markdown;
    
    // Handle code blocks first (preserve content but remove syntax)
    text = text.replace(/```[\w]*\n?([\s\S]*?)```/g, (match, code) => {
      return '\n--- CODE ---\n' + code.trim() + '\n--- END CODE ---\n';
    });
    
    // Remove inline code backticks but keep content
    text = text.replace(/`([^`]+)`/g, '$1');
    
    // Remove headers but keep content with proper spacing
    text = text.replace(/^#{1,6}\s+(.+)$/gm, '\n$1\n');
    
    // Remove bold and italic formatting
    text = text.replace(/\*\*(.*?)\*\*/g, '$1');
    text = text.replace(/__(.*?)__/g, '$1');
    text = text.replace(/\*(.*?)\*/g, '$1');
    text = text.replace(/_(.*?)_/g, '$1');
    
    // Remove strikethrough
    text = text.replace(/~~(.*?)~~/g, '$1');
    
    // Handle numbered lists - convert to clean format
    text = text.replace(/^\s*(\d+)\.\s+(.+)$/gm, '$1. $2');
    
    // Handle bullet points - convert to clean format
    text = text.replace(/^\s*[-*+]\s+(.+)$/gm, '• $1');
    
    // Remove blockquotes
    text = text.replace(/^>\s+/gm, '');
    
    // Remove horizontal rules
    text = text.replace(/^[-*_]{3,}$/gm, '');
    
    // Remove links but keep text
    text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
    text = text.replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1');
    
    // Remove images but keep alt text
    text = text.replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1');
    
    // Clean up multiple line breaks
    text = text.replace(/\n{3,}/g, '\n\n');
    
    // Clean up extra spaces
    text = text.replace(/[ \t]+/g, ' ');
    
    // Trim and return
    return text.trim();
  }


  // Load conversation
  async function loadConversation() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'getConversation' });
      chatMessages.innerHTML = '';
      
      if (response.conversation && response.conversation.length > 0) {
        response.conversation.forEach(msg => {
          addChatMessage(msg.content, msg.role);
        });
      } else {
        const welcomeMsg = document.createElement('div');
        welcomeMsg.className = 'chat-message assistant';
        welcomeMsg.textContent = 'Hi! I can help you analyze extracted text. Capture some text first, then ask me questions about it.';
        chatMessages.appendChild(welcomeMsg);
      }
    } catch (error) {
      console.log('Error loading conversation:', error);
    }
  }

  // History functionality
  async function loadHistory() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'getHistory' });
      historyList.innerHTML = '';
      
      if (response.history && response.history.length > 0) {
        response.history.forEach(item => {
          const historyItem = createHistoryItem(item);
          historyList.appendChild(historyItem);
        });
      } else {
        const emptyMsg = document.createElement('div');
        emptyMsg.className = 'history-empty';
        emptyMsg.textContent = 'No captures yet. Start by capturing some text!';
        emptyMsg.style.textAlign = 'center';
        emptyMsg.style.color = '#64748b';
        emptyMsg.style.padding = '20px';
        historyList.appendChild(emptyMsg);
      }
    } catch (error) {
      console.log('Error loading history:', error);
    }
  }

  function createHistoryItem(item) {
    const div = document.createElement('div');
    div.className = 'history-item';
    
    const header = document.createElement('div');
    header.className = 'history-item-header';
    
    const time = document.createElement('span');
    time.className = 'history-item-time';
    time.textContent = new Date(item.timestamp).toLocaleString();
    
    const action = document.createElement('span');
    action.className = 'history-item-action';
    action.textContent = item.action || 'analyze';
    
    header.appendChild(time);
    header.appendChild(action);
    
    const text = document.createElement('div');
    text.className = 'history-item-text';
    text.textContent = item.extractedText;
    
    div.appendChild(header);
    div.appendChild(text);
    
    div.addEventListener('click', () => {
      showResult(item);
      lastExtractedText = item.extractedText;
      switchTab('capture');
    });
    
    return div;
  }

  clearHistoryBtn.addEventListener('click', async () => {
    if (confirm('Are you sure you want to clear all history?')) {
      try {
        await chrome.runtime.sendMessage({ type: 'clearHistory' });
        loadHistory();
        showStatus('History cleared', 'success');
      } catch (error) {
        showStatus('Error clearing history', 'error');
      }
    }
  });

  // Settings
  settingsBtn.addEventListener('click', showSettings);

  function showSettings() {
    const settingsHTML = `
      <div class="settings-overlay">
        <div class="settings-modal">
          <div class="settings-header">
            <h3>Settings</h3>
            <button class="close-btn" id="closeSettings">×</button>
          </div>
          <div class="settings-content">
            <div class="setting-group">
              <label for="apiProvider">AI Provider:</label>
              <select id="apiProvider">
              <option value="gemini">Google Gemini(Recommended)</option>
                <option value="groq">Groq </option>
                
              </select>
            </div>
            
            <div class="setting-group" id="groqSettings">
              <label for="groqApiKey">Groq API Key:</label>
              <input type="password" id="groqApiKey" placeholder="Enter your Groq API key">
              <small>Get your API key from <a href="https://console.groq.com/keys" target="_blank">Groq Console</a></small>
            </div>
            
            <div class="setting-group" id="geminiSettings" style="display: none;">
              <label for="geminiApiKey">Gemini API Key:</label>
              <input type="password" id="geminiApiKey" placeholder="Enter your Gemini API key">
              <small>Get your API key from <a href="https://makersuite.google.com/app/apikey" target="_blank">Google AI Studio</a></small>
            </div>
            
            <div class="setting-group">
              <label for="ocrLanguage">OCR Language:</label>
              <select id="ocrLanguage">
                <option value="eng">English</option>
                <option value="spa">Spanish</option>
                <option value="fra">French</option>
                <option value="deu">German</option>
                <option value="chi_sim">Chinese (Simplified)</option>
                <option value="jpn">Japanese</option>
              </select>
            </div>
            
            <div class="settings-actions">
              <button class="btn-cancel" id="cancelSettings">Cancel</button>
              <button class="btn-save" id="saveSettings">Save</button>
            </div>
          </div>
        </div>
      </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', settingsHTML);
    
    // Load current settings
    chrome.storage.local.get(['apiProvider', 'groqApiKey', 'geminiApiKey', 'ocrLanguage']).then(settings => {
      if (settings.apiProvider) {
        document.getElementById('apiProvider').value = settings.apiProvider;
        toggleApiSettings(settings.apiProvider);
      }
      if (settings.groqApiKey) {
        document.getElementById('groqApiKey').value = settings.groqApiKey;
      }
      if (settings.geminiApiKey) {
        document.getElementById('geminiApiKey').value = settings.geminiApiKey;
      }
      if (settings.ocrLanguage) {
        document.getElementById('ocrLanguage').value = settings.ocrLanguage;
      }
    });
    
    // API provider change handler
    document.getElementById('apiProvider').addEventListener('change', (e) => {
      toggleApiSettings(e.target.value);
    });
    
    function toggleApiSettings(provider) {
      const groqSettings = document.getElementById('groqSettings');
      const geminiSettings = document.getElementById('geminiSettings');
      
      if (provider === 'groq') {
        groqSettings.style.display = 'block';
        geminiSettings.style.display = 'none';
      } else {
        groqSettings.style.display = 'none';
        geminiSettings.style.display = 'block';
      }
    }
    
    // Close settings
    document.getElementById('closeSettings').addEventListener('click', () => {
      document.querySelector('.settings-overlay').remove();
    });
    
    document.getElementById('cancelSettings').addEventListener('click', () => {
      document.querySelector('.settings-overlay').remove();
    });
    
    // Save settings
    document.getElementById('saveSettings').addEventListener('click', async () => {
      const apiProvider = document.getElementById('apiProvider').value;
      const groqApiKey = document.getElementById('groqApiKey').value.trim();
      const geminiApiKey = document.getElementById('geminiApiKey').value.trim();
      const ocrLanguage = document.getElementById('ocrLanguage').value;
      
      const requiredKey = apiProvider === 'groq' ? groqApiKey : geminiApiKey;
      
      if (!requiredKey) {
        alert(`Please enter a valid ${apiProvider === 'groq' ? 'Groq' : 'Gemini'} API key`);
        return;
      }
      
      try {
        await chrome.storage.local.set({
          apiProvider,
          groqApiKey,
          geminiApiKey,
          ocrLanguage
        });
        
        showStatus('Settings saved successfully!', 'success');
        document.querySelector('.settings-overlay').remove();
        checkApiConfiguration();
      } catch (error) {
        alert('Error saving settings: ' + error.message);
      }
    });
  }

  // Poll for results when processing
  function pollForResults() {
    const pollInterval = setInterval(async () => {
      try {
        const response = await chrome.runtime.sendMessage({ type: 'getResult' });
        
        if (!response.isProcessing) {
          clearInterval(pollInterval);
          hideLoading();
          
          if (response.result) {
            if (response.result.error) {
              showStatus(response.result.error, 'error');
            } else {
              showResult(response.result);
              lastExtractedText = response.result.extractedText;
              loadHistory(); // Refresh history
            }
          }
        }
      } catch (error) {
        clearInterval(pollInterval);
        hideLoading();
        showStatus('Error checking results', 'error');
      }
    }, 1000);
  }

  // Show result
  function showResult(result) {
    hideAll();
    textContent.textContent = result.extractedText;
    
    // Format analysis content
    let formattedAnalysis = formatAnalysisText(result.analysis);
    analysisContent.innerHTML = formattedAnalysis;
    
    resultSection.classList.remove('hidden');
  }

  // Format analysis text for better display
  function formatAnalysisText(text) {
    if (!text) return '';
    
    // Convert markdown-like formatting to HTML
    let formatted = text
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/`(.*?)`/g, '<code style="background: rgba(102, 126, 234, 0.1); padding: 2px 4px; border-radius: 3px;">$1</code>')
      .replace(/\n\n/g, '</p><p>')
      .replace(/\n/g, '<br>');
    
    return `<p>${formatted}</p>`;
  }

  // Show loading
  function showLoading() {
    hideAll();
    loadingSpinner.classList.remove('hidden');
  }

  // Hide loading
  function hideLoading() {
    loadingSpinner.classList.add('hidden');
  }

  // Show status
  function showStatus(message, type) {
    hideAll();
    statusElement.textContent = message;
    statusElement.className = `status ${type}`;
    statusElement.classList.remove('hidden');
  }

  // Hide all status elements
  function hideAll() {
    statusElement.classList.add('hidden');
    loadingSpinner.classList.add('hidden');
    resultSection.classList.add('hidden');
  }
});