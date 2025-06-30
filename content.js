// Content script for TextLens AI v2
let isSelectionActive = false;
let selectionOverlay = null;
let tesseractLoaded = false;
let lastOutputBox = null;
let lastSelectedRect = null;

// Enhanced styles with dark theme
const style = document.createElement('style');
style.textContent = `
  .textlens-selection-overlay {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background: rgba(0, 0, 0, 0.4);
    z-index: 999999;
    cursor: crosshair;
   
  }
  
  .textlens-selection-box {
    position: absolute;
    border: 2px dashed #667eea;
    background: rgba(102, 126, 234, 0.15);
    pointer-events: none;
    border-radius: 4px;
    box-shadow: 0 0 20px rgba(102, 126, 234, 0.3);
  }

  .textlens-selection-info {
    position: absolute;
    top: -30px;
    left: 0;
    background: rgba(102, 126, 234, 0.9);
    color: white;
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 12px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
    
  }

  .textlens-output-box {
    position: absolute;
    background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
    color: #e2e8f0;
    padding: 16px;
    border-radius: 12px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
    max-width: 450px;
    font-size: 14px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
    white-space: pre-wrap;
    z-index: 1000001;
    border: 1px solid rgba(102, 126, 234, 0.2);
    backdrop-filter: blur(20px);
  }

  .textlens-notification {
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 12px 20px;
    border-radius: 10px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
    font-size: 14px;
    font-weight: 500;
    z-index: 1000000;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    backdrop-filter: blur(20px);
    border: 1px solid rgba(255, 255, 255, 0.1);
  }
  
  .textlens-notification.success {
    background: linear-gradient(135deg, #10b981, #059669);
    color: white;
  }
  
  .textlens-notification.error {
    background: linear-gradient(135deg, #ef4444, #dc2626);
    color: white;
  }
  
  .textlens-notification.processing {
    background: linear-gradient(135deg, #3b82f6, #2563eb);
    color: white;
  }

  .textlens-hotkey-hint {
    position: fixed;
    bottom: 20px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(0, 0, 0, 0.8);
    color: white;
    padding: 8px 16px;
    border-radius: 20px;
    font-size: 12px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
    z-index: 1000000;
    backdrop-filter: blur(10px);
    border: 1px solid rgba(255, 255, 255, 0.1);
  }
`;
document.head.appendChild(style);

// Check if Tesseract is available
function checkTesseract() {
  return new Promise((resolve, reject) => {
    if (typeof Tesseract !== 'undefined') {
      tesseractLoaded = true;
      resolve();
    } else {
      reject(new Error('Tesseract.js not loaded. Please check extension installation.'));
    }
  });
}

// Listen for messages from popup and background
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Content script received message:', message);

  switch (message.type) {
    case 'ping':
      sendResponse({ success: true });
      break;

    case 'initSelection':
      initializeSelection();
      sendResponse({ success: true });
      break;

    case 'processingComplete':
      showNotification('Analysis complete! Check the popup for results.', 'success');
      break;

    case 'processingError':
      showNotification(`Error: ${message.error}`, 'error');
      break;

    case 'performOCR':
      performOCRInContent(message.imageData)
        .then(text => {
          sendResponse({ success: true, text: text });
        })
        .catch(error => {
          sendResponse({ success: false, error: error.message });
        });
      return true;
  }

  return true;
});

// Enhanced OCR with progress tracking
async function performOCRInContent(imageData) {
  try {
    if (!tesseractLoaded) {
      await checkTesseract();
    }

    showNotification('Extracting text...', 'processing');

    const { data: { text } } = await Tesseract.recognize(
      imageData,
      'eng',
      {
        logger: m => {
          if (m.status === 'recognizing text') {
            const progress = Math.round(m.progress * 100);
            showNotification(`Extracting text... ${progress}%`, 'processing');
          }
        }
      }
    );

    return text;
  } catch (error) {
    console.error('OCR error:', error);
    throw new Error(`OCR failed: ${error.message}`);
  }
}

// Enhanced selection with coordinates display
function initializeSelection() {
  if (isSelectionActive) return;

  isSelectionActive = true;
  selectionOverlay = document.createElement('div');
  selectionOverlay.className = 'textlens-selection-overlay';
  document.body.appendChild(selectionOverlay);

  // Add hotkey hint
  const hotkeyHint = document.createElement('div');
  hotkeyHint.className = 'textlens-hotkey-hint';
  hotkeyHint.textContent = 'Press ESC to cancel • Drag to select area';
  selectionOverlay.appendChild(hotkeyHint);

  let startX, startY, isSelecting = false;
  let selectionBox = null;
  let selectionInfo = null;

  selectionOverlay.addEventListener('mousedown', (e) => {
    e.preventDefault();
    isSelecting = true;
    startX = e.clientX;
    startY = e.clientY;

    selectionBox = document.createElement('div');
    selectionBox.className = 'textlens-selection-box';
    selectionOverlay.appendChild(selectionBox);

    selectionInfo = document.createElement('div');
    selectionInfo.className = 'textlens-selection-info';
    selectionBox.appendChild(selectionInfo);
  });

  selectionOverlay.addEventListener('mousemove', (e) => {
    if (!isSelecting || !selectionBox) return;

    const currentX = e.clientX;
    const currentY = e.clientY;

    const left = Math.min(startX, currentX);
    const top = Math.min(startY, currentY);
    const width = Math.abs(currentX - startX);
    const height = Math.abs(currentY - startY);

    selectionBox.style.left = left + 'px';
    selectionBox.style.top = top + 'px';
    selectionBox.style.width = width + 'px';
    selectionBox.style.height = height + 'px';

    if (selectionInfo) {
      selectionInfo.textContent = `${width} × ${height}`;
    }
  });

  selectionOverlay.addEventListener('mouseup', async (e) => {
    e.preventDefault();
    isSelecting = false;

    if (selectionBox) {
      const rect = selectionBox.getBoundingClientRect();

      if (rect.width < 20 || rect.height < 20) {
        showNotification('Selection too small. Please select a larger area.', 'error');
        cleanupSelection();
        return;
      }

      try {
        showNotification('Capturing and processing selection...', 'processing');

        const imageData = await captureArea(rect);
        lastSelectedRect = rect;

        chrome.runtime.sendMessage({
          type: 'selectionMade',
          data: { imageData }
        }).catch(error => {
          console.error('Error sending message to background:', error);
          showNotification('Error communicating with background script', 'error');
        });

      } catch (error) {
        console.error('Error processing selection:', error);
        showNotification(`Error: ${error.message}`, 'error');
      }
    }

    cleanupSelection();
  });

  // Enhanced escape handler
  const escapeHandler = (e) => {
    if (e.key === 'Escape' && isSelectionActive) {
      cleanupSelection();
      showNotification('Selection cancelled', 'error');
      document.removeEventListener('keydown', escapeHandler);
    }
  };
  document.addEventListener('keydown', escapeHandler);
}

// Enhanced capture with better quality
async function captureArea(rect) {
  try {
    if (selectionOverlay) {
      selectionOverlay.style.display = 'none';
    }

    if (typeof html2canvas === 'undefined') {
      throw new Error('html2canvas library not loaded. Please refresh the page and try again.');
    }

    const canvas = await html2canvas(document.body, {
      x: rect.left + window.scrollX,
      y: rect.top + window.scrollY,
      width: rect.width,
      height: rect.height,
      useCORS: true,
      allowTaint: true,
      scale: 2, // Higher quality
      backgroundColor: null,
      logging: false
    });

    return canvas.toDataURL('image/png', 0.9);

  } catch (error) {
    console.error('Error capturing area:', error);
    throw new Error('Failed to capture selected area: ' + error.message);
  } finally {
    if (selectionOverlay) {
      selectionOverlay.style.display = 'block';
    }
  }
}

function cleanupSelection() {
  isSelectionActive = false;
  if (selectionOverlay) {
    selectionOverlay.remove();
    selectionOverlay = null;
  }
}

// Enhanced notifications with animations
function showNotification(message, type = 'success') {
  const existing = document.querySelectorAll('.textlens-notification');
  existing.forEach(el => {
    el.style.transform = 'translateX(400px)';
    setTimeout(() => el.remove(), 300);
  });

  const notification = document.createElement('div');
  notification.className = `textlens-notification ${type}`;
  notification.textContent = message;
  notification.style.transform = 'translateX(400px)';
  document.body.appendChild(notification);

  // Animate in
  setTimeout(() => {
    notification.style.transform = 'translateX(0)';
  }, 10);

  // Auto remove
  setTimeout(() => {
    if (notification.parentNode) {
      notification.style.transform = 'translateX(400px)';
      setTimeout(() => notification.remove(), 300);
    }
  }, 4000);
}

console.log('TextLens AI v2 content script loaded');