export class DeepSpiderToolError extends Error {
  constructor(code, message, details = null) {
    if (typeof code !== 'string' || code.length === 0) {
      throw new TypeError('code must be a non-empty string')
    }
    if (typeof message !== 'string' || message.length === 0) {
      throw new TypeError('message must be a non-empty string')
    }

    super(message)
    this.name = 'DeepSpiderToolError'
    this.code = code
    this.details = details
  }
}
