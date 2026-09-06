import Movie from '../models/Movie.js';

export async function loadMovie(req, res, next, id) {
  if (!/^\d+$/.test(id)) return res.status(404).json({ error: 'Movie not found' });

  req.movie = await Movie.findByPk(id);
  if (!req.movie) return res.status(404).json({ error: 'Movie not found' });
  return next();
}

export async function list(req, res) {
  return res.json(await Movie.findAll({ order: [['id', 'ASC']] }));
}

export function get(req, res) {
  return res.json(req.movie);
}

export async function create(req, res) {
  const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
  if (!title || title.length > 255) return res.status(400).json({ error: 'Title must be between 1 and 255 characters' });
  return res.status(201).json(await Movie.create({ title }));
}

export async function update(req, res) {
  const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
  if (!title || title.length > 255) return res.status(400).json({ error: 'Title must be between 1 and 255 characters' });
  await req.movie.update({ title });
  return res.json(req.movie);
}

export async function remove(req, res) {
  await req.movie.destroy();
  return res.status(204).send();
}
