/**
 * lib/googleMaps.js
 * Link para abrir a localização de uma obra no Google Maps.
 *
 * Usa a Maps URL API (`/maps/search/?api=1`), que é o formato universal:
 * no celular o sistema abre o app nativo do Google Maps, no desktop abre o
 * site. Formatos antigos (`maps.google.com/?q=`) funcionam por
 * redirecionamento, mas nem sempre disparam o app no Android.
 *
 * Isto é o que transforma o registro em algo acionável: o mapa do app mostra
 * onde a arte está, e este link leva a pessoa até lá.
 */

export function googleMapsUrl(lat, lng) {
  const la = parseFloat(lat);
  const ln = parseFloat(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return '';
  // 6 casas decimais ≈ 11 cm de precisão — mais que suficiente pra um muro,
  // e evita URLs gigantes com o float completo.
  return `https://www.google.com/maps/search/?api=1&query=${la.toFixed(6)},${ln.toFixed(6)}`;
}
