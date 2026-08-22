'use client'

import { Bell, BellOff, Loader2, Share, Smartphone } from 'lucide-react'
import { useEffect, useState } from 'react'

import {
  sendTestPush,
  subscribeToPush,
  unsubscribeFromPush,
} from '@/lib/push-actions'

import { Button } from './ui/button'

/** VAPID public keys are base64url; the Push API wants raw bytes. */
function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = window.atob(base64)
  const output = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i)
  return output
}

type State = 'loading' | 'unsupported' | 'needs-install' | 'off' | 'on'

export function PushManager() {
  const [state, setState] = useState<State>('loading')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [subscription, setSubscription] = useState<PushSubscription | null>(null)

  useEffect(() => {
    async function init() {
      const isIOS =
        /iPad|iPhone|iPod/.test(navigator.userAgent) &&
        !('MSStream' in window)
      const standalone = window.matchMedia('(display-mode: standalone)').matches

      /* iOS only exposes the Push API to a PWA launched from the home screen.
         In Safari proper the APIs are simply absent, so telling the user to
         install is more useful than reporting "unsupported". */
      if (isIOS && !standalone) {
        setState('needs-install')
        return
      }

      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        setState('unsupported')
        return
      }

      const registration = await navigator.serviceWorker.register(
        new URL('../lib/service-worker.js', import.meta.url),
        { scope: '/', updateViaCache: 'none' },
      )

      const existing = await registration.pushManager.getSubscription()
      setSubscription(existing)
      setState(existing ? 'on' : 'off')
    }

    init().catch((error) => {
      console.error('[push] init failed', error)
      setState('unsupported')
    })
  }, [])

  async function enable() {
    setBusy(true)
    setMessage(null)
    try {
      const registration = await navigator.serviceWorker.ready
      const sub = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(
          process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
        ),
      })

      await subscribeToPush(
        JSON.parse(JSON.stringify(sub)),
        navigator.userAgent.slice(0, 120),
      )

      setSubscription(sub)
      setState('on')
      setMessage('This device will now get prep alerts.')
    } catch (error) {
      console.error('[push] subscribe failed', error)
      setMessage(
        'Could not enable notifications. Check that they are allowed for this site.',
      )
    } finally {
      setBusy(false)
    }
  }

  async function disable() {
    setBusy(true)
    setMessage(null)
    try {
      if (subscription) {
        await unsubscribeFromPush(subscription.endpoint)
        await subscription.unsubscribe()
      }
      setSubscription(null)
      setState('off')
      setMessage('Notifications turned off for this device.')
    } finally {
      setBusy(false)
    }
  }

  async function test() {
    setBusy(true)
    setMessage(null)
    const result = await sendTestPush()
    setMessage(
      result.ok
        ? `Sent to ${result.delivered} device${result.delivered === 1 ? '' : 's'}.`
        : result.error,
    )
    setBusy(false)
  }

  if (state === 'loading') {
    return <Loader2 className="text-ink-faint size-4 animate-spin" />
  }

  if (state === 'needs-install') {
    return (
      <div className="space-y-2 text-sm">
        <p className="flex items-center gap-2 font-medium">
          <Smartphone className="size-4" />
          Add Kaizr to your Home Screen first
        </p>
        <p className="text-ink-muted">
          On iPhone, notifications only work once the app is installed. Tap
          <Share className="mx-1 inline size-3.5" />
          Share, then <span className="text-ink">Add to Home Screen</span>, and
          open Kaizr from the new icon.
        </p>
      </div>
    )
  }

  if (state === 'unsupported') {
    return (
      <p className="text-ink-muted text-sm">
        This browser doesn&apos;t support push notifications. Try Chrome, Edge, or
        Safari 16.4+.
      </p>
    )
  }

  return (
    <div className="space-y-3">
      <p className="text-ink-muted text-sm">
        {state === 'on'
          ? 'Prep alerts and new-order pings are on for this device.'
          : 'Get a push when prep needs to start and when an order is coming up.'}
      </p>

      <div className="flex flex-wrap gap-2">
        {state === 'on' ? (
          <>
            <Button variant="secondary" onClick={disable} disabled={busy}>
              {busy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <BellOff className="size-4" />
              )}
              Turn off
            </Button>
            <Button variant="outline" onClick={test} disabled={busy}>
              Send test
            </Button>
          </>
        ) : (
          <Button variant="primary" onClick={enable} disabled={busy}>
            {busy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Bell className="size-4" />
            )}
            Enable notifications
          </Button>
        )}
      </div>

      {message && <p className="text-ink-faint text-xs">{message}</p>}
    </div>
  )
}
