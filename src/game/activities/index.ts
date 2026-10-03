import { FRASES } from '../story/phrases';
import type { ActivityId } from '../story/types';
import { DanceSequence } from './DanceSequence';
import { HealthyMenu } from './HealthyMenu';
import { Penalty } from './Penalty';
import { Recycling } from './Recycling';
import { RobotRoute } from './RobotRoute';
import { Trivia } from './Trivia';
import type { Activity, RandomFn } from './types';

export type { Activity } from './types';

/**
 * Crea una actividad nueva. `random` sólo lo usan las que tienen azar (baile,
 * penales); `phrases`, las que citan a un personaje (ver `story/phrases.ts`).
 */
export function createActivity(id: ActivityId, random: RandomFn = Math.random, phrases = FRASES): Activity {
  switch (id) {
    case 'robot':
      return new RobotRoute();
    case 'menu':
      return new HealthyMenu(phrases);
    case 'reciclaje':
      return new Recycling();
    case 'trivia':
      return new Trivia();
    case 'danza':
      return new DanceSequence(random, phrases);
    case 'penales':
      return new Penalty(random);
  }
}
