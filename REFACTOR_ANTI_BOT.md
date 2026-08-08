# Anti-Bot Detection Refactor

## Problem Identified

The original implementation automatically intercepted **every** file upload on AI sites by hijacking `drop` and `change` events. This approach had critical issues:

### Security & Detection Risks
- **Bot detection triggers**: AI platforms monitor DOM manipulation patterns, event timing, and user behavior anomalies
- **Man-in-the-Middle appearance**: Automatically intercepting and replacing files looks like automation/scraping
- **Account risk**: Users could face soft bans, hard bans, or account restrictions
- **Fragile**: Breaks when sites update their upload handlers or add bot detection

### Technical Issues
- Event interception happens before user intent is confirmed
- No explicit user consent for conversion
- Looks like unauthorized automation to site security systems

## Solution: Manual Trigger Model

### What Changed

Replaced automatic interception with **explicit user-triggered conversion**:

1. **Button Injection**: When a user selects/drops a file, FTM injects a "✨ Convert with FTM" button near the upload area
2. **User Confirmation Required**: Conversion only happens when user explicitly clicks the button
3. **Natural Behavior**: Mimics normal human interaction - no suspicious auto-interception
4. **Clean Teardown**: Buttons are removed after conversion or when user dismisses

### Key Benefits

✅ **Avoids Bot Detection**: No automatic event hijacking - waits for explicit user action  
✅ **User Consent**: Clear indication that conversion is happening  
✅ **Platform Friendly**: Doesn't interfere with normal upload flow unless requested  
✅ **Better UX**: User sees what's happening and can cancel anytime  
✅ **Sustainable**: Won't trigger anti-automation measures  

### Code Changes

#### Before (Automatic Interception)
```javascript
// Old approach: Auto-intercept every drop/change
document.addEventListener('drop', onDrop, true);
document.addEventListener('change', onChange, true);

function onDrop(event) {
  if (eligible(dt.files)) {
    event.preventDefault();  // Hijack the event
    event.stopPropagation();
    begin([...dt.files], { kind: 'drop', event });  // Auto-convert
  }
}
```

#### After (Manual Trigger)
```javascript
// New approach: Inject button, wait for user click
function handleFileSelect(event) {
  if (!eligible(input.files)) return;
  
  // Don't auto-intercept, just inject a button
  const btn = createConvertButton(input, input.files);
  if (btn) {
    injectButtonNear(input, btn);
  }
}

function createConvertButton(input, files) {
  const btn = document.createElement('button');
  btn.textContent = '✨ Convert with FTM';
  btn.addEventListener('click', async (e) => {
    e.preventDefault();
    await begin([...files], { kind: 'input', input });  // User-initiated
  });
  return btn;
}
```

### User Flow

1. **User drops/selects file** → Extension detects eligible file
2. **Button appears** → "✨ Convert with FTM" shown near upload area
3. **User decides** → Click to convert OR ignore to upload normally
4. **Conversion happens** → Only if user clicked the button
5. **Cleanup** → Button removed after conversion/dismissal

### Files Modified

- `content/intercept.js` — Complete rewrite from auto-intercept to manual trigger
- Added button injection logic with proper cleanup
- MutationObserver for dynamic content detection
- Maintained all security features (polyglot defense, magic bytes, etc.)

### Testing

All 144 existing tests pass ✅  
ESLint validation passes ✅  
No breaking changes to core functionality ✅

### Migration Notes

For users upgrading:
- Extension behavior is now more conservative by default
- Smart mode still activates only on AI sites
- Manual trigger provides better control and safety
- All file format support remains unchanged
- Security features fully preserved

## Conclusion

This refactor addresses the legitimate concern that automatic file interception could be flagged as bot activity. By requiring explicit user confirmation via a button click, the extension now:

- Operates within acceptable use patterns
- Respects user agency and consent
- Avoids triggering anti-automation defenses
- Maintains full functionality while being platform-friendly

The change makes FTM Studio sustainable for long-term use across all supported AI platforms.
