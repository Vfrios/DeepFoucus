I'm using the Pluggy API. Help me add this code to my project.
Ask the user to replace client_id & client_secret with their real access in their process.env to avoid manipulating credentials.

```javascript
// app/api/connect-token/route.ts
import { PluggyClient } from 'pluggy-sdk';

export async function POST(req: Request) {
  const pluggy = new PluggyClient({
    clientId: process.env.CLIENT_ID!,
    clientSecret: process.env.CLIENT_SECRET!,
  });

  const { clientUserId } = await req.json();

  const connectToken = await pluggy.createConnectToken({
    clientUserId, // Optional: track your users
  });

  return Response.json({ accessToken: connectToken.accessToken });
}
```

This endpoint creates a Connect Token server-side so my frontend can securely open Pluggy Connect. Keep credentials server-side only — never expose CLIENT_ID or CLIENT_SECRET in the browser.
{
  "connectToken": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJjbGllbnRJZCI6ImRjNGZmOGMwLWE0NWEtNDJhNS05ZGZmLTI4MTljYTg2MTlmZSIsImRhdGEiOiJkZjIxMWQxZTVlMDE5MGYxZmM4OTM5NmYyYTljNzVkZDo2MzFjMTdmMGIxOWM3Mzk2MTA0YjRlNTMxMTllYjdjZjkzZWIxZGVhYzJlNjNjZTE2YTMzMjE4MzlhNGNjYmI3Y2QxMjczNjJiMjkyMTEzOTAzZTY1ODNiOTMxNWFmYjgzYzZmNmM1ZTA2YjY3MmZiYjg3ZDA4ZDYzYmFjNzYzYzI0NWI5M2FhM2MzZmZlM2E5NWNkNmM3YjU0YmQwNDFlMmM0ZjMyNjdiMGI2YTNlNTYzNjBjOWNlNTI1OGYyMmE2NzZkZDkzMDM5NDM1YTIwNDdkNTA4ZmY5NTU3NjIxY2JiZjc1NDhlNTkyODk4Y2I0ODdkNzAwOTliZjkxMGM2IiwiaWF0IjoxNzkzMjg1MzI1LCJleHAiOjE3OTMyODcxMjV9.eWLYKSR3s8FD27AxFjOL4DaOvbj7DcsEaQw594bOpZzYKr6gBpolNBGxktTOWMInxYI8YNCOHV-O4amePovycM0OQdk5k4yE4PswOMBrU9D_wnMpBLpGNOvz-yuaGdud3KkGeQI_69CYRRxZ7uW42AWF_NP_BZD5sfHlvymvKI4EbTwhPH0nFtsktTyo3prW2in2az2hlQY94sGK8f_lcpym4t1Zix4KvjPdjRHZWHB-9wr6LGzbLebMztjsO4IVOm0Nn5xkHMkyHGyBgpbQgi9OovKSbDQaVqC8FssxQWftNpA1CguXc8HRjXDEI31EgClfOHQ4e3LaReEgsTvXoA"
}




I'm using the Pluggy API. Help me add this code to my project.
Ask the user to replace client_id & client_secret with their real access in their process.env to avoid manipulating credentials.

```tsx
import { PluggyConnect } from 'react-pluggy-connect'
import { useState, useEffect } from 'react'

function OpenFinanceConnect() {
  const [connectToken, setConnectToken] = useState('')

  useEffect(() => {
    // Fetch token from your backend (Step 2)
    fetch('/api/connect-token')
      .then(res => res.json())
      .then(data => setConnectToken(data.accessToken))
  }, [])

  if (!connectToken) return <div>Loading...</div>

  return (
    <PluggyConnect
      connectToken={connectToken}
      includeSandbox={true}
      onSuccess={(itemData) => {
        console.log('Connected!', itemData)
        // Send itemData.item.id to your backend
      }}
      onError={(error) => {
        console.error('Connection failed', error)
      }}
    />
  )
}
```

This code adds the Pluggy Connect widget to my frontend.It fetches a Connect Token from my backend and opens the Open Finance consent flow.The widget handles bank selection, authentication, and data sharing approval.Documentation: https://docs.pluggy.ai/docs/pluggy-connect



I'm using the Pluggy API. Help me add this code to my project.
Ask the user to replace client_id & client_secret with their real access in their process.env to avoid manipulating credentials.

```javascript
// app/api/webhooks/pluggy/route.ts (Next.js / Express)
export async function POST(req: Request) {
  const event = await req.json();

  console.log('Received webhook:', event.event);
  console.log('Event ID:', event.eventId);

  switch (event.event) {
    case 'item/created':
      await handleItemCreated(event.itemId);
      break;
    case 'item/updated':
      await handleItemUpdated(event.itemId);
      break;
    case 'item/error':
      await handleItemError(event.itemId, event.error);
      break;
  }

  // IMPORTANT: Return 2XX within 5 seconds
  return Response.json({ received: true });
}
```

This endpoint receives Pluggy webhook events(item / created, item / updated, item / error).It must respond with 2XX within 5 seconds.Process heavy work asynchronously.Documentation: https://docs.pluggy.ai/docs/webhooks

