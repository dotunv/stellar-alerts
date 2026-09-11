import React, {useState} from 'react'

type WebhookLog = {
  id: string
  statusCode: number | null
  error?: string | null
  payload?: any
}

type Props = {
  isOpen: boolean
  onClose: () => void
  logs: WebhookLog[]
}

export default function WebhookLogRetryModal({isOpen, onClose, logs}: Props) {
  const [items, setItems] = useState<WebhookLog[]>(logs)
  const [loadingMap, setLoadingMap] = useState<Record<string, boolean>>({})

  if (!isOpen) return null

  const handleRetry = async (log: WebhookLog) => {
    setLoadingMap(prev => ({...prev, [log.id]: true}))
    try {
      const resp = await fetch('/webhooks/retry', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({id: log.id}),
      })
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      // update local item to reflect retry attempt (optimistic)
      setItems(prev => prev.map(i => i.id === log.id ? {...i, statusCode: resp.status} : i))
    } catch (err: any) {
      setItems(prev => prev.map(i => i.id === log.id ? {...i, error: String(err)} : i))
    } finally {
      setLoadingMap(prev => ({...prev, [log.id]: false}))
    }
  }

  return (
    <div aria-modal="true" role="dialog" style={{position: 'fixed',inset:0,display:'flex',alignItems:'center',justifyContent:'center',background:'rgba(0,0,0,0.4)'}}>
      <div style={{width:720,maxHeight:'80vh',overflow:'auto',background:'#fff',borderRadius:6,padding:20}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <h3>Webhook Delivery Failures</h3>
          <button onClick={onClose} aria-label="close">Close</button>
        </div>

        {items.length === 0 ? (
          <p>No failed dispatches found.</p>
        ) : (
          <ul style={{listStyle:'none',padding:0,margin:0}}>
            {items.map(log => (
              <li key={log.id} style={{borderTop:'1px solid #eee',padding:'12px 0'}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                  <div>
                    <div><strong>ID:</strong> {log.id}</div>
                    <div><strong>Status:</strong> {log.statusCode ?? 'N/A'}</div>
                    {log.error ? <pre style={{whiteSpace:'pre-wrap',marginTop:8}}>{log.error}</pre> : null}
                  </div>
                  <div>
                    <button disabled={!!loadingMap[log.id]} onClick={() => handleRetry(log)}>
                      {loadingMap[log.id] ? 'Retrying...' : 'Re-send Webhook'}
                    </button>
                  </div>
                </div>
                {log.payload ? (
                  <details style={{marginTop:8}}>
                    <summary>Payload</summary>
                    <pre style={{whiteSpace:'pre-wrap'}}>{JSON.stringify(log.payload, null, 2)}</pre>
                  </details>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
