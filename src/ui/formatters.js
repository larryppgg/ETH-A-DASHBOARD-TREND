export function formatUsd(value) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "--";
  }
  return `$${value.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}

export function buildTooltipText(record) {
  if (!record) return "--";
  const date = record.date || "--";
  const price = formatUsd(record.input?.ethSpotPrice);
  return `${date} · ${price}`;
}
