# alegra-bank-payments-sync

Importa el extracto de movimientos de cuenta corriente (formato Banco General) y
te permite registrar en Alegra, para cada movimiento:

- **Débitos** (salidas de dinero) → comprobante de egreso / pago a proveedor, aplicado a la factura de compra pendiente.
- **Créditos** (entradas de dinero) → cobro de cliente, aplicado a la factura de venta pendiente.

Cada movimiento se revisa y confirma manualmente (contacto, factura(s) y monto a aplicar)
antes de enviarlo a Alegra, para evitar pagos o cobros mal aplicados. Los movimientos ya
procesados quedan guardados localmente para no duplicarlos si vuelves a subir el mismo extracto.

## Antes de usarlo en producción

El cliente de Alegra (`src/alegraClient.ts`) está armado según la estructura documentada
de la API v1 de Alegra, pero **no pudo probarse contra una cuenta real** al construir este
proyecto. Por defecto `DRY_RUN=true`: la app hace todo el flujo (buscar contacto, traer
facturas pendientes) pero en vez de crear el pago en Alegra, solo imprime en el log el
payload que enviaría. Antes de poner `DRY_RUN=false`:

1. Revisa el payload en los logs contra la documentación real de tu cuenta en
   https://developer.alegra.com/reference/post_payments
2. Si algún nombre de campo no coincide (por ejemplo `bankAccount`, `costCenter`, `type`),
   ajústalo en `createPayment()` dentro de `src/alegraClient.ts`.
3. Prueba primero con un movimiento de monto bajo.

## Nota sobre la dependencia `xlsx`

Las versiones de `xlsx` (SheetJS) publicadas en el registro de npm (hasta 0.18.5) tienen
vulnerabilidades conocidas sin parchear (prototype pollution, ReDoS). SheetJS solo publica
las versiones corregidas en su propio CDN, por eso `package.json` apunta a
`https://cdn.sheetjs.com/...` en vez de a una versión de npm. Esto es normal para este
paquete (así lo recomienda el propio proyecto) pero significa que necesitas conexión a
internet normal al hacer `npm install` (no funciona detrás de proxies que bloqueen dominios
no listados).

## Configuración

```
cp .env.example .env
```

Completa:

- `ALEGRA_EMAIL` / `ALEGRA_TOKEN`: credenciales de la API (Alegra > Configuración > API).
- `BASIC_AUTH_USER` / `BASIC_AUTH_PASSWORD`: usuario/clave para proteger la pantalla web.
- `DRY_RUN`: déjalo en `true` hasta validar el mapeo (ver arriba).

## Desarrollo local

```
npm install
npm run dev
```

Abre http://localhost:3000

## Despliegue con Docker (en tu propio servidor)

```
git clone <url-del-repo>
cd alegra-bank-payments-sync
cp .env.example .env   # y completa las credenciales
docker compose up -d --build
```

La app queda expuesta en el puerto `3000` del host (ajustable en `docker-compose.yml`).
Los datos (SQLite) se guardan en `./data`, montado como volumen para que sobrevivan a
un `docker compose up --build`.

## Despliegue automático (GitHub Actions)

El repo incluye `.github/workflows/deploy.yml`: en cada push a `main`, se conecta por SSH
a tu servidor y corre `git pull && docker compose up -d --build`. Para activarlo, agrega
estos *secrets* en GitHub (Settings → Secrets and variables → Actions) de este repositorio:

| Secret | Valor |
|---|---|
| `SSH_HOST` | IP o dominio de tu servidor |
| `SSH_USER` | usuario SSH |
| `SSH_PRIVATE_KEY` | clave privada SSH (sin passphrase) con acceso a ese usuario |
| `DEPLOY_PATH` | ruta absoluta donde clonaste el repo en el servidor, ej: `/opt/alegra-bank-payments-sync` |
| `SSH_PORT` | opcional, por defecto 22 |

La primera vez tienes que clonar el repo manualmente en el servidor (paso "Despliegue con
Docker" arriba); el workflow solo hace `git pull` + rebuild en despliegues siguientes.

## Formato del extracto esperado

Excel exportado por Banco General ("BGPCheckingMovementsExcel"), con columnas
`Fecha, Referencia, Transacción, Descripción, Débito, Crédito, Saldo total`. El parser
(`src/bankStatementParser.ts`) busca esa fila de encabezados dentro del archivo, ya que
las primeras filas traen metadata (número de cuenta, empresa, rango de fechas).
