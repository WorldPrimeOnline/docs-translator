# Webkassa API Integration

Source: `ИНТЕГРАТОРЫ_v4-2.0.3.postman_collection.json`

## WEBKASSA API AUDIT

```
auth endpoint:         POST /api/v4/Authorize
sale receipt:          POST /api/v4/check (OperationType=2)
refund receipt:        POST /api/v4/check (OperationType=3)
cashbox list:          POST /api/v4/Cashboxes
receipt by ext number: POST /api-history/v4/Ticket/GetTicketByExternalCheckNumber
receipt link:          GET  /api-history/v4/Ticket/GetTicketGroupUrl?ExternalLinkId={id}
print format:          POST /api/v4/Ticket/PrintFormat
check history:         POST /api/v4/Check/History
Z-report (close shift):POST /api/v4/ZReport
required env:          WEBKASSA_API_KEY, WEBKASSA_LOGIN, WEBKASSA_PASSWORD, WEBKASSA_CASHBOX_SERIAL_NUMBER
required payload:      Token, CashboxUniqueNumber, OperationType, Positions, Payments, ExternalCheckNumber
unknown / missing:     Production base URL (not in collection), cashbox shift management required?
```

## Overview

Webkassa is a cloud KKM (fiscal register) provider licensed in Kazakhstan.
It integrates with WOFD (ТОО Smartcontract) as the OFD (tax data operator).

## Authentication

**Two-layer auth:**

1. **x-api-key header** — required on EVERY request. Obtained from Webkassa admin portal.
2. **Bearer-style Token** — obtained from `/api/v4/Authorize`. Passed in request BODY (not header).

### Authorize endpoint

```
POST /api/v4/Authorize
Header: x-api-key: <your-api-key>
Body: { "Login": "<email>", "Password": "<password>" }
Response: { "Data": { "Token": "1a4e7fd2dfd84a7eb55d961d52470a70" } }
```

Error response:
```json
{ "Errors": [{ "Code": 1, "Text": "Неверный логин и/или пароль" }] }
```

Token lifetime: up to 24 hours. WPO caches token for 22 hours, re-auths on Error Code 2 (session expired).

## Base URLs

| Environment | URL |
|---|---|
| Test/Dev | `https://devkkm.webkassa.kz` |
| Production | **Unknown — confirm with Webkassa**. Set via `WEBKASSA_API_BASE_URL`. |

## Key Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/api/v4/Authorize` | POST | Get auth token |
| `/api/v4/check` | POST | Fiscalize a receipt (sale or refund) |
| `/api/v4/Cashboxes` | POST | List user's cashboxes |
| `/api/v4/Check/History` | POST | Cashbox check history |
| `/api-history/v4/Ticket/GetTicketByExternalCheckNumber` | POST | Get receipt by ExternalCheckNumber |
| `/api-history/v4/Ticket/GetTicketGroupUrl` | GET | Get public receipt group link |
| `/api/v4/Ticket/PrintFormat` | POST | Get printable ticket |
| `/api/v4/ZReport` | POST | Close shift (Z-report) |
| `/api/v4/XReport` | POST | X-report (shift summary without closing) |

## Sale Receipt (OperationType=2)

WPO uses `OperationType=2` (продажа) for card payments via Halyk ePay.

### Request

```json
{
  "Token": "<auth-token>",
  "CashboxUniqueNumber": "<WEBKASSA_CASHBOX_SERIAL_NUMBER>",
  "OperationType": 2,
  "Positions": [
    {
      "Count": 1,
      "Price": 1999,
      "TaxType": 0,
      "TaxPercent": 0,
      "Tax": 0,
      "PositionName": "Услуга перевода документа",
      "UnitCode": 796,
      "Discount": 0,
      "Markup": 0
    }
  ],
  "Payments": [
    {
      "Sum": 1999,
      "PaymentType": 1
    }
  ],
  "Change": 0,
  "RoundType": 2,
  "ExternalCheckNumber": "<payment_transaction.id>",
  "CustomerEmail": "<user-email>"
}
```

### Request field reference

| Field | Value for WPO | Notes |
|---|---|---|
| `OperationType` | `2` | Продажа (sale) |
| `Positions[].Count` | `1` | Single service unit |
| `Positions[].Price` | `amountKzt` | Full amount in KZT |
| `Positions[].TaxType` | `0` or `100` | 0=без НДС, 100=НДС. Confirm with accountant. |
| `Positions[].TaxPercent` | `0` or `12` | KZ VAT = 12%. Only used when TaxType=100. |
| `Positions[].Tax` | calculated | `amount - amount / (1 + taxPercent/100)`. 0 when TaxType=0. |
| `Positions[].PositionName` | `"Услуга перевода документа"` | Configurable via env. |
| `Positions[].UnitCode` | `796` | шт (piece). Standard for services. |
| `Payments[].PaymentType` | `1` | Банковская карта (bank card). |
| `RoundType` | `2` | Per Webkassa examples. |
| `ExternalCheckNumber` | `payment_transaction.id` | **IDEMPOTENCY KEY** (UUID). Must be unique per check. |
| `CustomerEmail` | user email | Optional. Webkassa emails receipt to customer if set. |

### Successful response

```json
{
  "Data": {
    "CheckNumber": "1675760809473",
    "DateTime": "28.01.2026 08:49:41",
    "DateTimeUTC": "28.01.2026 08:49:41 +05:00",
    "OfflineMode": false,
    "ShiftNumber": 16,
    "CheckOrderNumber": 4,
    "Total": 1999,
    "TicketUrl": "https://ctest3.wofd.kz/consumer?i=1675760809473&f=...",
    "TicketPrintUrl": "https://devkkm.webkassa.kz/spa-ui/ticket?..."
  }
}
```

### Response fields saved to DB

| `fiscal_receipts` column | Webkassa source |
|---|---|
| `provider_receipt_id` | `Data.CheckNumber` |
| `fiscal_url` | `Data.TicketUrl` (OFD link, if set) or `TicketPrintUrl` |
| `provider_shift_id` | `Data.ShiftNumber` |
| `provider_cashbox_id` | `WEBKASSA_CASHBOX_SERIAL_NUMBER` |
| `provider_response_sanitized` | `Data` (full, sanitized) |
| `status` | `issued` on success, `failed`/`retry_required` on error |

## Refund Receipt (OperationType=3)

Same `/api/v4/check` endpoint, `OperationType=3` (возврат продажи).

- `ExternalCheckNumber` = `refund_transaction.id` (NOT the original payment UUID)
- `Positions[].Price` = refund amount
- `Payments[].Sum` = refund amount

## Idempotency

`ExternalCheckNumber` is Webkassa's idempotency mechanism:
- Each value must be unique per cashbox shift.
- If the same ExternalCheckNumber is sent again, Webkassa returns **Error Code 14** + existing check Data.
- WPO treats Error 14 as **success** and returns the existing receipt.
- **Sale receipts**: `ExternalCheckNumber = payment_transaction.id` (UUID, globally unique).
- **Refund receipts**: `ExternalCheckNumber = refund_transaction.id` (UUID, globally unique).

## Error Codes

| Code | Meaning | WPO action |
|---|---|---|
| -1 | Unknown error | retry |
| 1 | Wrong login/password | fail, alert operator |
| 2 | Session expired | re-auth, retry |
| 3 | Not authorized | fail |
| 4 | No access to operation | fail |
| 5 | No cashbox access | fail |
| 6 | Cashbox not found | fail, check WEBKASSA_CASHBOX_SERIAL_NUMBER |
| 7 | Cashbox blocked | fail, alert operator |
| 9 | Validation error | fail, check request |
| 10 | Cashbox not activated | fail, check cashbox status |
| 11 | Shift over 24h | fail, Z-report needed |
| 12 | Shift already closed | fail, open new shift |
| 13 | No open shift | fail, operator must open shift |
| 14 | Duplicate ExternalCheckNumber | **SUCCESS** — return existing receipt |
| 505 | Service unavailable | retry |

## Operation Types

| Code | Name | Use |
|---|---|---|
| 0 | Покупка | Not used by WPO |
| 1 | Возврат покупки | Not used by WPO |
| 2 | Продажа | Card payment receipts |
| 3 | Возврат продажи | Refund receipts |

## Payment Types

| Code | Name | Use |
|---|---|---|
| 0 | Наличные | Not used (card only) |
| 1 | Банковская карта | Halyk ePay payments |
| 4 | Мобильный платеж | Future: if mobile payments added |

## Unit Codes

| Code | Name |
|---|---|
| 796 | шт (piece) — **used for WPO services** |

Full list available from `POST /api/v4/references/RefUnits`.

## Webkassa credentials: test vs production

`WEBKASSA_LOGIN` and `WEBKASSA_PASSWORD` must belong to the same Webkassa environment as `WEBKASSA_API_BASE_URL`.

For test integration:

- use credentials registered in `https://devkkm.webkassa.kz/`;
- set `FISCAL_PROVIDER_ENV=test`;
- set `WEBKASSA_ALLOW_REAL_RECEIPTS=false`.

For production fiscal receipts:

- use production Webkassa credentials/API credentials for the real cashbox;
- do not use `devkkm` credentials;
- set `FISCAL_PROVIDER_ENV=production`;
- production receipt calls require `WEBKASSA_ALLOW_REAL_RECEIPTS=true`.

Never mix test credentials with production base URL or production credentials with test base URL.

Prefer a dedicated API/integration user if Webkassa supports it. If Webkassa API uses regular cabinet credentials, store them only in Vercel/Railway environment variables.

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `FISCALIZATION_ENABLED` | Yes | `true` to enable. `false` = pending_manual for all receipts. |
| `FISCAL_PROVIDER` | Yes | `webkassa` to use Webkassa. `manual` = no API calls. |
| `FISCAL_PROVIDER_ENV` | Yes | `test` or `production`. Must match `HALYK_EPAY_MODE`. |
| `WEBKASSA_ENABLED` | Yes | `true` to allow Webkassa API calls. Safety gate. |
| `WEBKASSA_API_BASE_URL` | No | Default: `https://devkkm.webkassa.kz`. Production URL TBD. |
| `WEBKASSA_API_KEY` | Yes | x-api-key header. From Webkassa admin portal. |
| `WEBKASSA_LOGIN` | Yes | Email for `/api/v4/Authorize`. |
| `WEBKASSA_PASSWORD` | Yes | Password for `/api/v4/Authorize`. Never logged. |
| `WEBKASSA_CASHBOX_SERIAL_NUMBER` | Yes | ЗНК (заводской номер кассы), e.g., `SWK00529346`. |
| `WEBKASSA_CASHBOX_IDENTIFICATION_NUMBER` | No | ОФД identification number (35265). |
| `WEBKASSA_CASHBOX_REGISTRATION_NUMBER` | No | Gos.dokhod registration number. |
| `WEBKASSA_TAX_TYPE` | No | `0` = no VAT (default), `100` = VAT (НДС). Confirm with accountant. |
| `WEBKASSA_ALLOW_REAL_RECEIPTS` | Yes | **Production safety gate.** `true` only after accountant/OFD confirmation. |
| `WEBKASSA_SERVICE_NAME` | No | Override default receipt item name. |

## Safety Gates

All safety checks run before any HTTP call. If any gate fails, fiscal receipt is set to
`pending_manual` or `blocked_by_config` — no API call made, payment/job continues.

1. `WEBKASSA_ENABLED !== 'true'` → `pending_manual`
2. Missing credentials → `pending_manual` + error log
3. `FISCAL_PROVIDER_ENV=production` + `WEBKASSA_ALLOW_REAL_RECEIPTS !== 'true'` → `blocked_by_config`

## Staging / Test Checklist

- [ ] Get test credentials from Webkassa: API key, login, password, test cashbox ЗНК
- [ ] Set `FISCAL_PROVIDER_ENV=test` and `WEBKASSA_API_BASE_URL=https://devkkm.webkassa.kz`
- [ ] Set `WEBKASSA_ENABLED=true`, `FISCALIZATION_ENABLED=true`, `FISCAL_PROVIDER=webkassa`
- [ ] Leave `WEBKASSA_ALLOW_REAL_RECEIPTS=false` (test mode doesn't require this gate)
- [ ] Run a test Halyk payment
- [ ] Confirm `fiscal_receipts.status = issued` and `fiscal_url` is set
- [ ] Open `TicketUrl` in browser — confirm receipt is visible on OFD portal

## Production Checklist

- [ ] Accountant confirms: ИП `840324300155` is VAT registered or exempt
- [ ] Accountant confirms: TaxType=0 (no VAT) is correct for translation services
- [ ] Production API key, login, password received from Webkassa account manager
- [ ] Production cashbox ЗНК (SWK serial) confirmed active and assigned to the ИП
- [ ] OFD (WOFD/Smartcontract or other) contract active for the cashbox
- [ ] Shift management confirmed: Webkassa auto-opens shift or operator opens manually
- [ ] Confirm production base URL with Webkassa
- [ ] Set `WEBKASSA_API_BASE_URL=<production-url>`, `FISCAL_PROVIDER_ENV=production`
- [ ] Set `WEBKASSA_ALLOW_REAL_RECEIPTS=true`
- [ ] Run one real controlled payment (small amount)
- [ ] Confirm receipt appears in production OFD portal
- [ ] Confirm receipt emailed to customer (if CustomerEmail set)

## Known Unknowns

1. **Production base URL** — not in collection. The collection only shows `devkkm.webkassa.kz` (test).
   Confirm with Webkassa account manager before production launch.

2. **Shift management** — `POST /api/v4/ZReport` closes shift. If shift is not open, receipts fail
   with Error 13. Webkassa may auto-open shifts, or an operator must open manually. Confirm.

3. **VAT status** — ИП `840324300155` tax treatment for translation services. Requires accountant
   to confirm TaxType=0 (no VAT) before going live.

4. **CustomerXin** — the collection mentions a real IIN/BIN is required if CustomerXin is provided.
   WPO does not collect customer IIN → `CustomerXin` is not sent (optional field).

## What to Confirm with Accountant

1. Is `840324300155` registered as a VAT payer? → sets `WEBKASSA_TAX_TYPE`
2. Is the KKM registered and active for online payments?
3. What OFD is registered for the cashbox?
4. Refund correction receipt: when is it required? (KZ law)
5. How often must Z-reports (shift closings) be done?
6. Are translation services classifiable under a specific commodity code?
