/**
 * Offsets oficiais da Meta Marketing API por moeda.
 * @see https://developers.facebook.com/docs/marketing-api/currencies
 * offset 100 → usuário digita unidades com centavos (ex.: BRL 50,00 → API 5000)
 * offset 1   → usuário digita unidade inteira (ex.: COP 72700 → API 72700)
 */
const META_CURRENCY_OFFSET_1 = new Set([
  "CLP",
  "COP",
  "CRC",
  "HUF",
  "IDR",
  "ISK",
  "JPY",
  "KRW",
  "PYG",
  "TWD",
  "VND",
]);

/** @param {string} currencyCode */
export function getMetaCurrencyOffset(currencyCode) {
  const c = String(currencyCode || "").trim().toUpperCase();
  return META_CURRENCY_OFFSET_1.has(c) ? 1 : 100;
}

/** @param {string} currencyCode */
export function budgetInputHintPt(currencyCode) {
  const c = String(currencyCode || "").trim().toUpperCase();
  if (getMetaCurrencyOffset(c) === 1) {
    return "Informe o orçamento em unidades inteiras da moeda (sem centavos). Ex.: 72700.";
  }
  return "Informe o orçamento na moeda da conta (ex.: 50 ou 50,50 em reais).";
}
