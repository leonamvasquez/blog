/**
 * Enhanced clipboard functionality for share button
 * Ensures copy link button works reliably
 */

document.addEventListener('DOMContentLoaded', function() {
  const copyButton = document.getElementById('copy-link');
  
  if (!copyButton) return;
  
  // Fallback clipboard function
  function fallbackCopyToClipboard(text) {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-999999px';
    textArea.style.top = '-999999px';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    
    try {
      document.execCommand('copy');
      return true;
    } catch (err) {
      console.error('Fallback: Could not copy text: ', err);
      return false;
    } finally {
      document.body.removeChild(textArea);
    }
  }
  
  // Enhanced copy function
  function copyToClipboard(text) {
    // Try modern clipboard API first
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    } else {
      // Fallback for older browsers or non-HTTPS
      return new Promise((resolve, reject) => {
        if (fallbackCopyToClipboard(text)) {
          resolve();
        } else {
          reject(new Error('Could not copy to clipboard'));
        }
      });
    }
  }
  
  // Add click handler
  copyButton.addEventListener('click', function(e) {
    e.preventDefault();
    
    const button = e.currentTarget;
    const currentUrl = window.location.href;
    
    // Get tooltip instance
    let tooltip = bootstrap.Tooltip.getInstance(button);
    if (!tooltip) {
      tooltip = new bootstrap.Tooltip(button);
    }
    
    copyToClipboard(currentUrl)
      .then(() => {
        // Success feedback
        const originalTitle = button.getAttribute('data-bs-original-title');
        const successTitle = button.getAttribute('data-title-succeed') || 'Link copiado!';
        
        // Update tooltip
        button.setAttribute('data-bs-original-title', successTitle);
        tooltip.setContent({ '.tooltip-inner': successTitle });
        
        // Change icon temporarily
        const icon = button.querySelector('i');
        const originalClass = icon.className;
        icon.className = 'fa-fw fas fa-check text-success';
        
        // Reset after 2 seconds
        setTimeout(() => {
          button.setAttribute('data-bs-original-title', originalTitle);
          tooltip.setContent({ '.tooltip-inner': originalTitle });
          icon.className = originalClass;
        }, 2000);
        
        // Show tooltip briefly
        tooltip.show();
        setTimeout(() => tooltip.hide(), 1500);
      })
      .catch((err) => {
        console.error('Could not copy to clipboard:', err);
        
        // Error feedback
        const errorTitle = 'Erro ao copiar';
        const originalTitle = button.getAttribute('data-bs-original-title');
        
        button.setAttribute('data-bs-original-title', errorTitle);
        tooltip.setContent({ '.tooltip-inner': errorTitle });
        tooltip.show();
        
        setTimeout(() => {
          button.setAttribute('data-bs-original-title', originalTitle);
          tooltip.setContent({ '.tooltip-inner': originalTitle });
          tooltip.hide();
        }, 2000);
      });
  });
  
  // Initialize tooltip
  new bootstrap.Tooltip(copyButton);
});