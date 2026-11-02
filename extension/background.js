// Hush for Gmail - Background Service Worker

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'CREATE_EMAIL_TRACKER') {
    handleCreateTracker(message)
      .then((res) => {
        console.log('[Hush Background] Created tracker successfully:', res);
        sendResponse(res);
      })
      .catch((err) => {
        console.error('[Hush Background] Failed to create tracker:', err);
        sendResponse({ error: err.message });
      });
    return true; // Keep message channel open for async response
  }

  if (message.action === 'SELF_VIEW') {
    handleSelfView(message.id)
      .then((res) => sendResponse(res))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }
});

async function handleCreateTracker({ to, subject, link }) {
  const config = await chrome.storage.local.get(['workerUrl', 'apiToken']);
  const workerUrl = (config.workerUrl || '').replace(/\/+$/, '');
  const apiToken = config.apiToken || '';

  if (!workerUrl || !apiToken) {
    throw new Error('Hush is not configured. Please set Worker URL and API token in extension options.');
  }

  console.log('[Hush Background] Calling Worker:', `${workerUrl}/api/emails`, { to, subject });

  const res = await fetch(`${workerUrl}/api/emails`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiToken}`
    },
    body: JSON.stringify({
      to: to || 'recipient@unknown.com',
      subject: subject || '',
      link: link || ''
    })
  });

  if (!res.ok) {
    const errorText = await res.text();
    console.error('[Hush Background] Worker error response:', res.status, errorText);
    throw new Error(`Worker returned ${res.status}: ${errorText}`);
  }

  const data = await res.json();
  return { id: data.id, workerUrl };
}

async function handleSelfView(id) {
  const config = await chrome.storage.local.get(['workerUrl', 'apiToken']);
  const workerUrl = (config.workerUrl || '').replace(/\/+$/, '');
  const apiToken = config.apiToken || '';

  if (!workerUrl || !apiToken || !id) return { ok: false };

  await fetch(`${workerUrl}/api/emails/${id}/self-view`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiToken}`
    }
  }).catch(() => {});

  return { ok: true };
}
