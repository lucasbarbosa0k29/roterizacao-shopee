This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Google Places New: operação segura

Mantenha a API New desativada e o fluxo Legacy como padrão até concluir a
validação controlada:

```env
GOOGLE_PLACES_NEW_MANUAL_SEARCH_ENABLED=0
NEXT_PUBLIC_GOOGLE_PLACES_MANUAL_SEARCH_MODE=legacy
GOOGLE_PLACES_TRUST_PROXY=0
```

O servidor aceita exclusivamente `GOOGLE_PLACES_API_KEY`; nunca coloque essa
chave em uma variável `NEXT_PUBLIC_*`. O limite por usuário não depende de IP.

No Render, habilite `GOOGLE_PLACES_TRUST_PROXY=1` somente após confirmar que o
serviço recebe o header `CF-Connecting-IP` escrito pelo edge Render/Cloudflare.
O código aceita somente esse header e ignora `X-Forwarded-For` e `X-Real-IP`,
pois esses headers podem conter valores fornecidos pelo cliente ou anexados por
proxies intermediários. Se o header confiável não existir, o limite por IP não
é aplicado, mas o limite por usuário continua ativo.

Use `compare` apenas com administradores presentes em
`GOOGLE_PLACES_COMPARE_USER_IDS` ou `GOOGLE_PLACES_COMPARE_EMAILS`. Não ative o
frontend globalmente em `new` durante a validação.
