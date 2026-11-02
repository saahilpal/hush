document.addEventListener('DOMContentLoaded', () => {
  const workerUrlInput = document.getElementById('worker-url');
  const apiTokenInput = document.getElementById('api-token');
  const saveBtn = document.getElementById('btn-save');
  const testBtn = document.getElementById('btn-test');
  const statusDiv = document.getElementById('status');

  // Load existing configuration from chrome.storage.local
  chrome.storage.local.get(['workerUrl', 'apiToken'], (res) => {
    if (res.workerUrl) workerUrlInput.value = res.workerUrl;
    if (res.apiToken) apiTokenInput.value = res.apiToken;
  });

  saveBtn.addEventListener('click', async () => {
    let workerUrl = workerUrlInput.value.trim().replace(/\/+$/, '');
    const apiToken = apiTokenInput.value.trim();

    if (!workerUrl) {
      statusDiv.className = 'status error';
      statusDiv.textContent = 'Worker URL is required';
      return;
    }

    if (!apiToken) {
      statusDiv.className = 'status error';
      statusDiv.textContent = 'API token is required';
      return;
    }

    if (!/^https?:\/\//i.test(workerUrl)) {
      workerUrl = 'https://' + workerUrl;
    }

    try {
      await chrome.storage.local.set({ workerUrl, apiToken });
      statusDiv.className = 'status success';
      statusDiv.textContent = 'Settings saved successfully!';
      setTimeout(() => {
        statusDiv.textContent = '';
      }, 3000);
    } catch (err) {
      statusDiv.className = 'status error';
      statusDiv.textContent = err.message || 'Error saving settings';
    }
  });

  testBtn.addEventListener('click', async () => {
    let workerUrl = workerUrlInput.value.trim().replace(/\/+$/, '');
    const apiToken = apiTokenInput.value.trim();

    if (!workerUrl || !apiToken) {
      statusDiv.className = 'status error';
      statusDiv.textContent = 'Please enter both Worker URL and API Token first.';
      return;
    }

    if (!/^https?:\/\//i.test(workerUrl)) {
      workerUrl = 'https://' + workerUrl;
    }

    statusDiv.className = 'status';
    statusDiv.textContent = 'Testing connection to Worker...';

    chrome.runtime.sendMessage(
      { action: 'TEST_CONNECTION', workerUrl, apiToken },
      (response) => {
        if (chrome.runtime.lastError) {
          statusDiv.className = 'status error';
          statusDiv.textContent = 'Extension error: ' + chrome.runtime.lastError.message;
          return;
        }

        if (response && response.ok) {
          statusDiv.className = 'status success';
          statusDiv.textContent = `✓ Connected! Hush Worker v${response.version || '1.2'} is healthy.`;
        } else {
          statusDiv.className = 'status error';
          statusDiv.textContent = `✗ Connection failed: ${response?.error || 'Unknown error'}`;
        }
      }
    );
  });
});
