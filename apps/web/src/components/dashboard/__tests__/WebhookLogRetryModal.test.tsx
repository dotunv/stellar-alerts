import React from 'react'
import {render, fireEvent, waitFor} from '@testing-library/react'
import {vi, describe, it, expect, beforeEach, afterEach} from 'vitest'
import WebhookLogRetryModal from '../WebhookLogRetryModal'

describe('WebhookLogRetryModal', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    // @ts-ignore
    global.fetch = vi.fn()
  })

  afterEach(() => {
    // @ts-ignore
    global.fetch = originalFetch
    vi.resetAllMocks()
  })

  it('renders logs and triggers retry POST', async () => {
    const logs = [{id: 'log-1', statusCode: null, error: 'timeout', payload: {foo: 'bar'}}]
    // @ts-ignore
    global.fetch.mockResolvedValue({ok: true, status: 200})

    const onClose = vi.fn()
    const {getByText} = render(<WebhookLogRetryModal isOpen={true} onClose={onClose} logs={logs} />)

    expect(getByText('Webhook Delivery Failures')).toBeTruthy()
    const button = getByText('Re-send Webhook')
    fireEvent.click(button)

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/webhooks/retry', expect.objectContaining({method: 'POST'}))
    })

    await waitFor(() => {
      expect(getByText('Status: 200')).toBeTruthy()
    })
  })
})
