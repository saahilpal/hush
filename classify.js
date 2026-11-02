export function classify({
  ua = '',
  net = '',
  country = '',
  ageMs,
  quietMs = 90000,
  isClick = false,
  isSelfView = false,
  selfViewReason = '',
  mxProvider = 'unknown'
} = {}) {
  const uaStr = typeof ua === 'string' ? ua : '';
  const netStr = typeof net === 'string' ? net : '';
  const countryStr = typeof country === 'string' ? country.trim() : '';

  let kind = '';
  let why = '';

  // 0. Sender self-view check (authenticated session, sender IP, or extension alert)
  if (isSelfView) {
    kind = 'auto';
    why = selfViewReason || 'Sender viewed sent email';
  }
  // 1. Initial quiet window (< quietMs)
  else if (typeof ageMs === 'number' && ageMs < quietMs) {
    kind = 'auto';
    why = 'Right after sending';
  }
  // 2. Security scanner (bot UA or security network)
  else if (
    /bot|spider|crawl|scan|curl|wget|python|java\/|go-http|node|headless|preview|barracuda|proofpoint|mimecast|symantec|trend|ironport|forcepoint|sophos|zscaler/i.test(uaStr) ||
    /proofpoint|mimecast|barracuda|symantec|cisco|trend micro|forcepoint|sophos|zscaler|trellix|fireeye|mailguard|darktrace|abnormal/i.test(netStr)
  ) {
    kind = 'auto';
    why = 'Security scanner';
  }
  // 3. GoogleImageProxy handling:
  // - If recipient is not on Google Workspace, GoogleImageProxy is 100% the sender
  else if (/GoogleImageProxy/i.test(uaStr)) {
    if (mxProvider && mxProvider !== 'unknown' && mxProvider !== 'google') {
      kind = 'auto';
      why = `Sender view in Gmail (recipient on ${mxProvider})`;
    } else {
      kind = 'likely';
      why = 'Gmail';
    }
  } else if (/YahooMailProxy/i.test(uaStr)) {
    kind = 'likely';
    why = 'Yahoo Mail';
  }
  // 4. Apple network
  else if (/apple/i.test(netStr)) {
    kind = 'auto';
    why = 'Apple Mail privacy proxy';
  }
  // 5. Data center network
  else if (/amazon|aws|digitalocean|linode|ovh|hetzner|oracle|alibaba|vultr|choopa|leaseweb|scaleway|contabo|m247/i.test(netStr)) {
    kind = 'auto';
    why = 'Data center, likely a scanner';
  }
  // 6. Apple Mail prefetch
  else if (/AppleWebKit/i.test(uaStr) && !/Safari|Chrome|Version/i.test(uaStr)) {
    kind = 'auto';
    why = 'Apple Mail, may be prefetched';
  }
  // 7. Outlook / Office
  else if (/Outlook|Office/i.test(uaStr)) {
    kind = 'likely';
    why = countryStr ? `Outlook, ${countryStr}` : 'Outlook';
  }
  // 8. Otherwise
  else {
    kind = 'likely';
    why = countryStr ? `Opened on a device, ${countryStr}` : 'Opened on a device';
  }

  // Handle click transformation
  if (isClick) {
    if (kind === 'likely') {
      kind = 'confirmed';
      why = countryStr ? `Link clicked, ${countryStr}` : 'Link clicked';
    } else {
      why = `Link clicked, ${why.toLowerCase()}`;
    }
  }

  return [kind, why];
}
