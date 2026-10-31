/** Orders strings by code unit, so sorting doesn't depend on the machine's locale. */
export const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
