fetch("https://generativelanguage.googleapis.com/v1beta/models?key=mock", { signal: AbortSignal.timeout(5000) })
  .then(r => console.log("Fetch Status:", r.status))
  .catch(e => console.log("Fetch Error:", e.message));
