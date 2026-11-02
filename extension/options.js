document.addEventListener('DOMContentLoaded', () => {
  const workerUrlInput = document.getElementById('worker-url');
  const apiTokenInput = document.getElementById('api-token');
  const saveBtn = document.getElementById('btn-save');
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
      statusDiv.textContent = 'Saved successfully!';
      setTimeout(() => {
        statusDiv.textContent = '';
      }, 2500);
    } catch (err) {
      statusDiv.className = 'status error';
      statusDiv.textContent = err.message || 'Error saving settings';
    }
  });
});
