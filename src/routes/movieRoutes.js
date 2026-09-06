import { Router } from 'express';
import authenticate from '../middleware/authenticate.js';
import * as movies from '../controllers/movieController.js';

const router = Router();

router.use(authenticate);
router.param('id', movies.loadMovie);
router.route('/').get(movies.list).post(movies.create);
router.route('/:id').get(movies.get).put(movies.update).delete(movies.remove);

export default router;
