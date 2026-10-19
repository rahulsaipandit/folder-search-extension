/**
 * The product's friendly name, sent with feedback as "Extension Used". A constant on purpose: the
 * manifest `extName` message is the store/package name (`image-text-search`), not the product name.
 */
export const EXTENSION_FRIENDLY_NAME = 'Folder Search'

export function extensionName(): string {
	return EXTENSION_FRIENDLY_NAME
}
