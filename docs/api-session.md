# API session

Real requests and responses, captured from a fresh checkout. It was set up with `cp .env.example .env`, `npm run seed`, `npm run build` and `npm start`, in `TIKTOK_MODE=mock` with the seeded demo keys. Nothing left the machine, and no ad or spend was created. IDs and timestamps will differ on your run.

### Health check

```
$ curl 'localhost:3000/health'
```

```
HTTP/1.1 200 OK

{
  "status": "ok"
}
```

### No API key

```
$ curl -X 'POST' 'localhost:3000/api/ads/tiktok/boost' -H 'Content-Type: application/json' -d '{"tiktokPostId":"7300000000000000001","adName":"Launch","budget":25,"startDate":"2030-01-01T00:00:00Z","endDate":"2030-01-08T00:00:00Z"}'
```

```
HTTP/1.1 401 Unauthorized

{
  "action": "request",
  "status": "error",
  "code": 102,
  "message": "API Key not valid. Please verify your API Key in the Ayrshare dashboard.",
  "details": "Missing Authorization header. Send \"Authorization: Bearer <API_KEY>\" using the API Key from the Ayrshare dashboard."
}
```

### Every validation problem in one response

```
$ curl 'localhost:3000/api/ads/tiktok/boost' -H 'Authorization: Bearer demo-api-key-active' -H 'Content-Type: application/json' -d '{"tiktokPostId":7300000000000000001,"adName":"Launch","budget":19.999,"goal":"sales","endDate":"2030-01-08"}'
```

```
HTTP/1.1 400 Bad Request

{
  "action": "request",
  "status": "error",
  "code": 101,
  "message": "Missing or incorrect parameters. Please verify with the docs. https://www.ayrshare.com/docs/apis",
  "details": "Invalid fields: tiktokPostId must be sent as a string: this number is too large to be represented exactly, so its digits were already changed in transit. Quote the ID, e.g. \"7301234567890123456\"; goal must be one of: engagement, video_views, reach, traffic; budget must have at most 2 decimal places (USD); endDate must be an ISO 8601 date-time with a timezone, e.g. \"2026-11-01T09:00:00Z\"."
}
```

### Dry run: validate and plan, create nothing

```
$ curl 'localhost:3000/api/ads/tiktok/boost' -H 'Authorization: Bearer demo-api-key-active' -H 'Content-Type: application/json' -d '{"tiktokPostId":"7300000000000000001","adName":"Launch","budget":25,"startDate":"2030-01-01T00:00:00Z","endDate":"2030-01-08T00:00:00Z","dryRun":true}'
```

```
HTTP/1.1 200 OK

{
  "status": "success",
  "dryRun": true,
  "adName": "Launch",
  "advertiserId": "7100000000000000001",
  "adStatus": "active",
  "goal": {
    "type": "engagement",
    "title": "Get More Engagement",
    "description": "Show the post to people likely to follow, like, comment and share."
  },
  "budget": 25,
  "budgetType": "daily",
  "bidAmount": null,
  "maxSpend": 175,
  "startDate": "2030-01-01T00:00:00.000Z",
  "endDate": "2030-01-08T00:00:00.000Z",
  "minAge": 18,
  "maxAge": 65,
  "gender": "all",
  "locations": {
    "countries": [
      "US"
    ],
    "locationIds": []
  },
  "interests": [],
  "callToAction": null,
  "postId": null,
  "tiktokPostId": "7300000000000000001",
  "authorizationType": "linked_account",
  "targetLocationIds": [
    "6252001"
  ],
  "committedSpend": 0,
  "limits": {
    "maxSpendPerBoost": 5000,
    "maxSpendPerProfile": 20000
  },
  "sparkAuthorizationEndsAt": null
}
```

### Boost with an Idempotency-Key

```
$ curl 'localhost:3000/api/ads/tiktok/boost' -H 'Authorization: Bearer demo-api-key-active' -H 'Content-Type: application/json' -H 'Idempotency-Key: demo-1' -d '{"tiktokPostId":"7300000000000000001","adName":"Launch","budget":25,"startDate":"2030-01-01T00:00:00Z","endDate":"2030-01-08T00:00:00Z"}'
```

```
HTTP/1.1 200 OK

{
  "status": "success",
  "id": "bst_5cf2ff364e4a60b3fd9f",
  "boostStatus": "live",
  "adId": "1830000000000000003",
  "adGroupId": "1820000000000000002",
  "campaignId": "1810000000000000001",
  "adName": "Launch - bst_5cf2ff364e4a60b3fd9f",
  "advertiserId": "7100000000000000001",
  "adStatus": "active",
  "goal": {
    "type": "engagement",
    "title": "Get More Engagement",
    "description": "Show the post to people likely to follow, like, comment and share."
  },
  "budget": 25,
  "budgetType": "daily",
  "bidAmount": null,
  "maxSpend": 175,
  "startDate": "2030-01-01T00:00:00.000Z",
  "endDate": "2030-01-08T00:00:00.000Z",
  "minAge": 18,
  "maxAge": 65,
  "gender": "all",
  "locations": {
    "countries": [
      "US"
    ],
    "locationIds": []
  },
  "interests": [],
  "callToAction": null,
  "postId": null,
  "tiktokPostId": "7300000000000000001",
  "authorizationType": "linked_account",
  "createdAt": "2026-11-07T20:45:21.644Z"
}
```

### Retry with the same key: replayed, no second ad

```
$ curl 'localhost:3000/api/ads/tiktok/boost' -H 'Authorization: Bearer demo-api-key-active' -H 'Content-Type: application/json' -H 'Idempotency-Key: demo-1' -d '{"tiktokPostId":"7300000000000000001","adName":"Launch","budget":25,"startDate":"2030-01-01T00:00:00Z","endDate":"2030-01-08T00:00:00Z"}'
```

```
HTTP/1.1 200 OK
Idempotent-Replayed: true

{
  "status": "success",
  "id": "bst_5cf2ff364e4a60b3fd9f",
  "boostStatus": "live",
  "adId": "1830000000000000003",
  "adGroupId": "1820000000000000002",
  "campaignId": "1810000000000000001",
  "adName": "Launch - bst_5cf2ff364e4a60b3fd9f",
  "advertiserId": "7100000000000000001",
  "adStatus": "active",
  "goal": {
    "type": "engagement",
    "title": "Get More Engagement",
    "description": "Show the post to people likely to follow, like, comment and share."
  },
  "budget": 25,
  "budgetType": "daily",
  "bidAmount": null,
  "maxSpend": 175,
  "startDate": "2030-01-01T00:00:00.000Z",
  "endDate": "2030-01-08T00:00:00.000Z",
  "minAge": 18,
  "maxAge": 65,
  "gender": "all",
  "locations": {
    "countries": [
      "US"
    ],
    "locationIds": []
  },
  "interests": [],
  "callToAction": null,
  "postId": null,
  "tiktokPostId": "7300000000000000001",
  "authorizationType": "linked_account",
  "createdAt": "2026-11-07T20:45:21.644Z"
}
```

### Same key, different body

```
$ curl 'localhost:3000/api/ads/tiktok/boost' -H 'Authorization: Bearer demo-api-key-active' -H 'Content-Type: application/json' -H 'Idempotency-Key: demo-1' -d '{"tiktokPostId":"7300000000000000001","adName":"Launch","budget":30,"startDate":"2030-01-01T00:00:00Z","endDate":"2030-01-08T00:00:00Z"}'
```

```
HTTP/1.1 409 Conflict

{
  "action": "request",
  "status": "error",
  "code": 608,
  "message": "This Idempotency-Key was already used with a different request body.",
  "details": "Idempotency-Key \"demo-1\" was first used at 2026-11-07T20:45:21.643Z for a different request (different profile, endpoint or body). Use a new key for a new boost; reuse a key only to retry the exact same request."
}
```

### Look the boost up later

```
$ curl 'localhost:3000/api/ads/tiktok/boost/bst_5cf2ff364e4a60b3fd9f' -H 'Authorization: Bearer demo-api-key-active'
```

```
HTTP/1.1 200 OK

{
  "status": "success",
  "id": "bst_5cf2ff364e4a60b3fd9f",
  "boostStatus": "live",
  "adId": "1830000000000000003",
  "adGroupId": "1820000000000000002",
  "campaignId": "1810000000000000001",
  "adName": "Launch - bst_5cf2ff364e4a60b3fd9f",
  "advertiserId": "7100000000000000001",
  "adStatus": "active",
  "goal": {
    "type": "engagement",
    "title": "Get More Engagement",
    "description": "Show the post to people likely to follow, like, comment and share."
  },
  "budget": 25,
  "budgetType": "daily",
  "bidAmount": null,
  "maxSpend": 175,
  "startDate": "2030-01-01T00:00:00.000Z",
  "endDate": "2030-01-08T00:00:00.000Z",
  "minAge": 18,
  "maxAge": 65,
  "gender": "all",
  "locations": {
    "countries": [
      "US"
    ],
    "locationIds": []
  },
  "interests": [],
  "callToAction": null,
  "postId": null,
  "tiktokPostId": "7300000000000000001",
  "authorizationType": "linked_account",
  "createdAt": "2026-11-07T20:45:21.644Z"
}
```

### Over the per-boost spend cap

```
$ curl 'localhost:3000/api/ads/tiktok/boost' -H 'Authorization: Bearer demo-api-key-active' -H 'Content-Type: application/json' -d '{"tiktokPostId":"7300000000000000001","adName":"Big","budget":800,"startDate":"2030-01-01T00:00:00Z","endDate":"2030-01-08T00:00:00Z","dryRun":true}'
```

```
HTTP/1.1 400 Bad Request

{
  "action": "boost post",
  "status": "error",
  "code": 604,
  "message": "The requested budget exceeds the spend limit for this account.",
  "details": "This boost could spend up to 5600.00 USD (800.00 USD/day × 7 days), above the per-boost limit of 5000.00 USD. Lower the budget or shorten the schedule."
}
```

### Expired Spark code

```
$ curl 'localhost:3000/api/ads/tiktok/boost' -H 'Authorization: Bearer demo-api-key-active' -H 'Content-Type: application/json' -d '{"authCode":"SPARK-DEMO-EXPIRED-CODE","adName":"Creator","budget":25,"startDate":"2030-01-01T00:00:00Z","endDate":"2030-01-08T00:00:00Z","dryRun":true}'
```

```
HTTP/1.1 400 Bad Request

{
  "action": "boost post",
  "status": "error",
  "code": 602,
  "message": "The TikTok Spark authorization code is invalid, expired, or already used.",
  "details": "TikTok rejected the authCode: The auth code has expired. (TikTok code 40002, request_id mock-req-16). Ask the creator for a new Spark authorization code (TikTok app → post → Ad settings) and retry."
}
```

### Profile with no TikTok ads account

```
$ curl 'localhost:3000/api/ads/tiktok/boost' -H 'Authorization: Bearer demo-api-key-active' -H 'Profile-Key: demo-profile-key-no-tiktok' -H 'Content-Type: application/json' -d '{"tiktokPostId":"7300000000000000001","adName":"Launch","budget":25,"startDate":"2030-01-01T00:00:00Z","endDate":"2030-01-08T00:00:00Z"}'
```

```
HTTP/1.1 400 Bad Request

{
  "action": "boost post",
  "status": "error",
  "code": 601,
  "message": "No usable TikTok ads account is linked to this profile.",
  "details": "User Profile \"No TikTok Ads\" has no linked TikTok ads account. Link a TikTok Ads Manager account to this profile in the Ayrshare dashboard, then retry."
}
```
