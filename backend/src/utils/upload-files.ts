import { existsSync, unlinkSync } from 'node:fs'
import { rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { RequestHandler } from 'express'
import sharp from 'sharp'

/** Lado maior da foto guardada (detalhe do caso) e da miniatura (cartões, listas e avatares). */
export const maxImageSide = 1600
export const thumbnailSide = 640
const originalExtensions = ['.jpg', '.png', '.webp']

/**
 * `1731-abc.jpg` → `1731-abc.thumb.webp`. A web e o app derivam a URL da miniatura pela mesma regra,
 * sem mudar o contrato da API (o campo continua sendo a URL da foto original).
 */
export function thumbnailFilename(filename: string) {
  return filename.replace(/\.(jpg|png|webp)$/i, '.thumb.webp')
}

export function makeThumbnail(image: Buffer | string) {
  return sharp(image, { failOn: 'error', limitInputPixels: 40_000_000 })
    .resize({ width: thumbnailSide, height: thumbnailSide, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 76 })
    .toBuffer()
}

/** Apaga a foto e a miniatura derivada (o caminho já foi validado pelo chamador). */
export function removeUploadFile(target: string) {
  for (const file of new Set([target, thumbnailFilename(target)])) if (existsSync(file)) unlinkSync(file)
}

const pending = new Map<string, Promise<void>>()

/**
 * Fotos enviadas antes das miniaturas: a primeira requisição de `<nome>.thumb.webp` gera o arquivo a partir
 * do original e o estático o serve. Sem original (ou imagem ilegível) segue para o 404 e o cliente usa a foto.
 */
export function thumbnailFallback(uploadRoot: string): RequestHandler {
  return (req, _res, next) => {
    const match = /^\/([\w-]+)\.thumb\.webp$/.exec(req.path)
    if (!match || (req.method !== 'GET' && req.method !== 'HEAD')) return next()
    const target = join(uploadRoot, `${match[1]}.thumb.webp`)
    if (existsSync(target)) return next()
    const source = originalExtensions.map((extension) => join(uploadRoot, `${match[1]}${extension}`)).find((file) => existsSync(file))
    if (!source) return next()

    let job = pending.get(target)
    if (!job) {
      const temporary = `${target}.${process.pid}.tmp`
      job = makeThumbnail(source)
        .then((thumbnail) => writeFile(temporary, thumbnail))
        .then(() => rename(temporary, target))
        .catch(async () => {
          await unlink(temporary).catch(() => undefined)
        })
        .finally(() => pending.delete(target))
      pending.set(target, job)
    }
    void job.then(() => next())
  }
}
