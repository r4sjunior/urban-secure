/**
 * Representa uma obra de arte urbana registrada no Urban Secure.
 * Cada campo corresponde a um atributo do NFT mintado na Solana.
 */
export interface UrbanArt {
  /** Endereço do mint do NFT na Solana (chave primária on-chain) */
  id: string;

  /** Nome da obra / artista */
  name: string;

  /** Descrição da obra */
  description: string;

  /** Latitude da localização da obra */
  lat: number;

  /** Longitude da localização da obra */
  lng: number;

  /** URL da imagem armazenada no IPFS via Pinata */
  imageUrl: string;

  /** Endereço público da carteira Solana do artista */
  artistWallet: string;

  /** Timestamp Unix (ms) do momento do mint */
  timestamp: number;
}
