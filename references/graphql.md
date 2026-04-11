# Safe Raw GraphQL Patterns

Use raw GraphQL only when the CLI does not yet support the operation.

## Correct

```bash
BODY=$'## Heading\n\nParagraph one.\n\nParagraph two.'
curl -s -X POST https://api.linear.app/graphql \
  -H "Authorization: $LINEAR_API_KEY" \
  -H "Content-Type: application/json" \
  --data-binary "$(jq -n --arg body "$BODY" '{query: "mutation($body:String!){commentCreate(input:{body:$body}){success}}", variables: {body: $body}}')"
```

## Wrong

```bash
curl -s -X POST https://api.linear.app/graphql \
  -H "Authorization: $LINEAR_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"query\": \"mutation { commentCreate(input: { body: \\\"$BODY\\\" }) { success } }\"}"
```

Why wrong: string interpolation breaks on quotes/newlines and creates injection risk.
