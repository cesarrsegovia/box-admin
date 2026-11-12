/**
 * Los textos que el alta y la ficha de una sala comparten.
 *
 * Viven aqui y no en un `page.tsx` porque Next 15 no deja que una pagina
 * exporte nada mas que su `default`.
 */

/**
 * Un nombre vacio —o de solo espacios— no se manda. El MISMO texto en el alta
 * y en la ficha: la misma regla no puede tener dos frases.
 */
export const FALTA_EL_NOMBRE = 'Ponele un nombre.';
