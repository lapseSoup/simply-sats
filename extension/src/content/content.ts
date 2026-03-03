/**
 * Simply Sats — Content Script
 *
 * Injected into web pages to provide the window.simplySats provider
 * for dApp integration. Acts as a message bridge between the page
 * and the extension's service worker.
 *
 * @module extension/content/content
 */

// Inject the in-page script that exposes window.simplySats
const script = document.createElement('script')
script.src = chrome.runtime.getURL('inpage.js')
script.type = 'module'
;(document.head || document.documentElement).appendChild(script)
script.onload = () => script.remove()

// Bridge messages between page and service worker
window.addEventListener('message', (event) => {
  if (event.source !== window) return
  if (event.data?.target !== 'simply-sats-content') return

  // Forward to service worker
  chrome.runtime.sendMessage(
    { type: 'DAPP_REQUEST', payload: event.data.payload, origin: window.location.origin },
    (response) => {
      // Forward response back to page
      window.postMessage(
        { target: 'simply-sats-inpage', payload: response },
        '*'
      )
    }
  )
})

// Listen for messages from service worker (e.g., wallet locked notification)
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'WALLET_EVENT') {
    window.postMessage(
      { target: 'simply-sats-inpage', payload: message },
      '*'
    )
  }
})
