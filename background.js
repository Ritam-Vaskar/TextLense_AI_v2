// Background script for TextLens AI v2
let analysisResult = null;
let isProcessing = false;
let conversationHistory = [];
let captureHistory = [];

// Handle keyboard shortcuts
chrome.commands.onCommand.addListener((command) => {
  if (command === 'capture-screen') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'initSelection' });
      }
    });
  }
});

// Handle messages from content script and popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Background received message:', message);

  switch (message.type) {
    case 'startSelection':
      analysisResult = null;
      isProcessing = false;
      sendResponse({ success: true });
      break;

    case 'selectionMade':
      isProcessing = true;
      processSelection(message.data, sender.tab.id)
        .then(result => {
          analysisResult = result;
          isProcessing = false;
          
          // Add to history
          addToHistory(result);
          
          // Send result back to content script
          if (sender.tab && sender.tab.id) {
            chrome.tabs.sendMessage(sender.tab.id, {
              type: 'processingComplete',
              result: result
            }).catch(err => console.log('Error sending message to tab:', err));
          }
        })
        .catch(error => {
          isProcessing = false;
          analysisResult = { error: error.message };
          if (sender.tab && sender.tab.id) {
            chrome.tabs.sendMessage(sender.tab.id, {
              type: 'processingError',
              error: error.message
            }).catch(err => console.log('Error sending message to tab:', err));
          }
        });
      
      sendResponse({ success: true });
      break;

    case 'getResult':
      sendResponse({
        result: analysisResult,
        isProcessing: isProcessing
      });
      break;

    case 'clearResult':
      analysisResult = null;
      sendResponse({ success: true });
      break;

    case 'sendMessage':
      handleChatMessage(message.data)
        .then(response => sendResponse({ success: true, response }))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true;

    case 'getHistory':
      sendResponse({ history: captureHistory });
      break;

    case 'clearHistory':
      captureHistory = [];
      chrome.storage.local.set({ captureHistory: [] });
      sendResponse({ success: true });
      break;

    case 'getConversation':
      sendResponse({ conversation: conversationHistory });
      break;

    case 'clearConversation':
      conversationHistory = [];
      sendResponse({ success: true });
      break;
  }

  return true;
});

// Process the selected area
async function processSelection(data, tabId) {
  try {
    console.log('Processing selection:', data);
    
    // Perform OCR on the image using content script
    const extractedText = await performOCRInContentScript(data.imageData, tabId);
    console.log('Extracted text:', extractedText);
    
    if (!extractedText.trim()) {
      throw new Error('No text found in the selected area');
    }
    
    // Get default action from settings
    const settings = await chrome.storage.local.get(['defaultAction']);
    const defaultAction = settings.defaultAction || 'analyze';
    
    let analysis;
    switch (defaultAction) {
      case 'explain':
        analysis = await analyzeWithAI(extractedText, 'Explain this text in simple terms');
        break;
      case 'summarize':
        analysis = await analyzeWithAI(extractedText, 'Provide a brief summary of this text,if it is a multiple choice question, provide the answer only');
        break;
      case 'translate':
        analysis = await analyzeWithAI(extractedText, 'Translate this text to Hindi');
        break;
      case 'solve':
        analysis = await analyzeWithAI(extractedText, 'Solve this problem step by step');
        break;
      default:
        analysis = await analyzeWithAI(extractedText, 'Analyze this text and provide insights');
    }
    
    return {
      extractedText: extractedText,
      analysis: analysis,
      timestamp: new Date().toISOString(),
      action: defaultAction
    };
    
  } catch (error) {
    console.error('Error processing selection:', error);
    throw error;
  }
}

// Perform OCR using content script
async function performOCRInContentScript(imageData, tabId) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, {
      type: 'performOCR',
      imageData: imageData
    }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(`OCR failed: ${chrome.runtime.lastError.message}`));
        return;
      }
      
      if (response.success) {
        resolve(response.text);
      } else {
        reject(new Error(`OCR failed: ${response.error}`));
      }
    });
  });
}

// Handle chat messages
async function handleChatMessage(data) {
  const { message, context } = data;
  
  // Add user message to conversation
  conversationHistory.push({
    role: 'user',
    content: message,
    timestamp: new Date().toISOString()
  });
  
  // Get AI response
  const response = await analyzeWithAI(context || '', message);
  
  // Add AI response to conversation
  conversationHistory.push({
    role: 'assistant',
    content: response,
    timestamp: new Date().toISOString()
  });
  
  return response;
}

// Analyze text with AI (supports both Groq and Gemini)
async function analyzeWithAI(text, prompt = 'Analyze this text and provide insights') {
  const settings = await chrome.storage.local.get(['apiProvider', 'groqApiKey', 'geminiApiKey']);
  const provider = settings.apiProvider || 'groq';
  
  if (provider === 'groq') {
    return await analyzeWithGroq(text, prompt, settings.groqApiKey);
  } else {
    return await analyzeWithGemini(text, prompt, settings.geminiApiKey);
  }
}

// Analyze with Groq API
async function analyzeWithGroq(text, prompt, apiKey) {
  if (!apiKey) {
    throw new Error('Groq API key not configured. Please set it in the extension settings.');
  }

  const API_URL = 'https://api.groq.com/openai/v1/chat/completions';

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'llama3-70b',
        messages: [
          {
            role: 'user',
            content: `${prompt}:\n\n"${text}"`
          }
        ],
        temperature: 0.7,
        max_tokens: 1000
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Groq API error: ${errorData.error?.message || response.statusText}`);
    }

    const data = await response.json();

    if (!data.choices || !data.choices[0] || !data.choices[0].message?.content) {
      throw new Error('Invalid response from Groq API');
    }

    return data.choices[0].message.content;

  } catch (error) {
    console.error('Groq API error:', error);
    throw new Error(`Failed to analyze text: ${error.message}`);
  }
}

// Analyze with Gemini API
async function analyzeWithGemini(text, prompt, apiKey) {
  if (!apiKey) {
    throw new Error('Gemini API key not configured. Please set it in the extension settings.');
  }

  const MODEL_NAME = 'gemini-2.5-flash';
  const API_VERSION = 'v1';
  const API_URL = `https://generativelanguage.googleapis.com/${API_VERSION}/models/${MODEL_NAME}:generateContent?key=${apiKey}`;

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: `${prompt}:\n\n"${text}"`
          }]
        }]
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Gemini API error: ${errorData.error?.message || response.statusText}`);
    }

    const data = await response.json();

    const result = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!result) {
      throw new Error('Invalid response from Gemini API');
    }

    return result;

  } catch (error) {
    console.error('Gemini API error:', error);
    throw new Error(`Failed to analyze text: ${error.message}`);
  }
}

// Add result to history
function addToHistory(result) {
  captureHistory.unshift({
    id: Date.now(),
    extractedText: result.extractedText,
    analysis: result.analysis,
    timestamp: result.timestamp,
    action: result.action
  });
  
  // Keep only last 50 items
  if (captureHistory.length > 50) {
    captureHistory = captureHistory.slice(0, 50);
  }
  
  // Save to storage
  chrome.storage.local.set({ captureHistory });
}

// Load history on startup
chrome.storage.local.get(['captureHistory']).then(result => {
  if (result.captureHistory) {
    captureHistory = result.captureHistory;
  }
});