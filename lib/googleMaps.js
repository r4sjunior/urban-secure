/**
 * lib/googleMaps.js
 * Links para o Google Maps a partir das coordenadas de uma obra.
 *
 * Duas intenções DIFERENTES, e usar a errada é um bug de produto:
 *
 *   `/maps/search/`  → só centraliza o mapa no ponto. O usuário chega lá e
 *                      vê um alfinete solto, com as coordenadas cruas no
 *                      campo de busca. Ele ainda precisa tocar em "rotas",
 *                      confirmar origem e só então começar a andar.
 *
 *   `/maps/dir/`     → abre a NAVEGAÇÃO, com a origem preenchida pela
 *                      localização atual do aparelho e a rota já traçada.
 *
 * O app é sobre ir até o muro. `dir` é a intenção certa — era o que estava
 * errado antes.
 *
 * Ambas usam a Maps URL API (`api=1`), o formato universal: no celular o
 * sistema abre o app nativo, no desktop abre o site. Formatos antigos
 * (`maps.google.com/?q=`) funcionam por redirecionamento, mas nem sempre
 * disparam o app no Android.
 */

/** 6 casas ≈ 11 cm — precisão de sobra para um muro, sem URL gigante. */
function coord(lat, lng) {
  const la = parseFloat(lat);
  const ln = parseFloat(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return null;
  if (la < -90 || la > 90 || ln < -180 || ln > 180) return null;
  return `${la.toFixed(6)},${ln.toFixed(6)}`;
}

/**
 * Abre a navegação até a obra, com a rota já traçada da posição atual.
 *
 * Sem `origin`: omitir faz o Google usar a localização do aparelho. Passar
 * a nossa leitura de GPS seria pior — ela pode estar minutos desatualizada,
 * e o app de mapas tem um fix melhor que o nosso.
 *
 * `travelmode=walking` porque arte urbana se alcança a pé: o trecho final
 * quase sempre é uma viela ou calçada onde a rota de carro não entra.
 */
export function googleMapsUrl(lat, lng) {
  const destino = coord(lat, lng);
  if (!destino) return '';
  return `https://www.google.com/maps/dir/?api=1&destination=${destino}&travelmode=walking`;
}

/** Só mostra o ponto no mapa, sem iniciar rota. Para quando a intenção é
 *  "onde fica isso?" e não "me leve até lá". */
export function googleMapsViewUrl(lat, lng) {
  const ponto = coord(lat, lng);
  if (!ponto) return '';
  return `https://www.google.com/maps/search/?api=1&query=${ponto}`;
}
