import type { ActivityId, DialogueChoice, DialogueDef, DialogueNode, Effect, TalkRule } from './types';

/**
 * Diálogos del Recorrido 40, en castellano rioplatense.
 *
 * Los personajes son ficticios; lo que cuentan de la escuela es lo que se ve
 * en ella (los murales, los carteles, los ambientes del plano y del
 * recorrido de 2020). Las opiniones son de los personajes, no datos de la
 * institución.
 *
 * Formato: cada nodo sigue al siguiente de la lista salvo que diga `next`
 * ('$end' termina) o tenga opciones. `{objetivo}` y `{sellos}` los completa
 * el director con el estado del juego.
 */

type Extra = Partial<Omit<DialogueNode, 'id' | 'who' | 'text'>>;
const n = (id: string, who: string, text: string, extra: Extra = {}): DialogueNode => ({ id, who, text, ...extra });
const dlg = (id: string, ...nodes: DialogueNode[]): DialogueDef => ({ id, nodes });
const END = '$end';

/**
 * Bloque de entrevista para "Voces del recorrido": una línea de saludo, la
 * invitación a preguntar (sólo si todavía no se lo entrevistó) y dos
 * preguntas a elección; la respuesta queda guardada como cita.
 */
function withInterview(npc: string, greeting: string, invite: string, qas: ReadonlyArray<readonly [string, string]>): DialogueNode[] {
  const choices: DialogueChoice[] = [
    { text: '¿Te puedo hacer una pregunta para el recorrido?', next: 'iv', if: (q) => !q.interviewed(npc) },
    { text: '¡Nada, gracias!', next: END },
  ];
  return [
    n('hola', npc, greeting, { choices }),
    n('iv', npc, invite, { choices: qas.map(([qq], k) => ({ text: qq, next: `iv${k}` })) }),
    ...qas.map(([, a], k) => n(`iv${k}`, npc, a, { effects: [{ do: 'interview', id: npc, quote: a } as Effect], next: END })),
  ];
}

const go = (id: ActivityId): Effect => ({ do: 'activity', id });
const done = (id: string): Effect => ({ do: 'complete', id });

export const DIALOGUES: readonly DialogueDef[] = [
  // =============================================================== prólogo
  dlg(
    'ruben.intro',
    n('a', 'ruben', '¡Buen día! Vos sos quien arma el Recorrido 40, ¿no? La directora me avisó que venías.', {
      anim: 'wave',
      choices: [
        { text: '¡Sí! Hoy empezamos.', next: 'si' },
        { text: '¿El Recorrido 40? Contame.', next: 'que' },
      ],
    }),
    n('si', 'ruben', 'Así me gusta. Cuarenta años no se cumplen todos los días.', { next: 'abre' }),
    n('que', 'ruben', 'Una visita por toda la escuela para el aniversario: los patios, las aulas, el jardín… Y al final, el acto en el Polideportivo.', {
      anim: 'talk',
    }),
    n('abre', 'ruben', 'Pasá, que te abro. Inés, la directora, te espera en Recepción, al lado del mural.', {
      anim: 'point',
      effects: [done('p.portero'), { do: 'unlock', zone: 'entrada' }],
    }),
    n('lola', 'lola', '¡Vamos! Yo me encargo de las fotos del recorrido.', { next: END }),
  ),
  dlg(
    'ines.mural',
    n('a', 'ines', '¡Hola! Antes de empezar, mirá el mural de San Martín, acá en el muro oeste. Leé el lema y después charlamos.', { anim: 'point', next: END }),
  ),
  dlg(
    'ines.intro',
    n('a', 'ines', '¡Llegaste! Qué lindo empezar el día con ese lema, ¿no?', { anim: 'wave' }),
    n('b', 'ines', 'Este año la escuela cumple 40 años. «40 años construyendo la mejor escuela», como dice el logo del aniversario.', { anim: 'talk' }),
    n('c', 'ines', 'Queremos que cualquier visitante pueda recorrerla y entender cómo se vive acá adentro. Por eso te elegimos para armar el Recorrido 40.', {
      choices: [
        { text: '¿Qué tengo que hacer?', next: 'plan' },
        { text: '¿Por qué yo?', next: 'yo' },
      ],
    }),
    n('yo', 'ines', 'Porque conocés la escuela y porque, según Lola, no parás de hacer preguntas.'),
    n('yo2', 'lola', '¡Es verdad! Pregunta todo.', { next: 'plan' }),
    n('plan', 'ines', 'Te doy el Pasaporte 40. Cada sector que recorras te va a dar un sello: escuchá a la gente, ayudá en lo que haga falta y mirá con atención.', {
      anim: 'talk',
      effects: [{ do: 'item', id: 'pasaporte' }],
    }),
    n('pb', 'ines', 'Empezá por la planta baja: el Aula Maker, la cantina y el Espacio recreativo. El primer piso y el jardín se van abriendo a medida que avances.'),
    n('fin', 'ines', 'Y al final nos juntamos todos en el Polideportivo para el acto. ¡Contamos con vos!', {
      anim: 'wave',
      effects: [done('p.directora'), { do: 'phase', phase: 'clase' }],
      next: END,
    }),
  ),
  dlg(
    'ines.hub',
    n('a', 'ines', 'Ahora te toca: {objetivo}. Llevás {sellos} sellos en el Pasaporte 40.', { anim: 'talk', next: END }),
  ),

  // ============================================================ capítulo 1
  dlg(
    'tomas.intro',
    n('a', 'tomas', '¡Hola! Soy Abi. Bienvenidos al Aula Maker. Acá imaginamos, diseñamos, creamos, aprendemos y compartimos: está escrito en el mural.', { anim: 'wave' }),
    n('b', 'tomas', 'Para el recorrido quiero que un robot Educabot cruce la pista con la bandera del 40. ¿Lo programamos?', {
      anim: 'point',
      effects: [{ do: 'flag', id: 'robotExplicado' }],
      choices: [
        { text: '¡Dale, programemos!', next: 'go' },
        { text: '¿Cómo se programa?', next: 'como' },
      ],
    }),
    n('como', 'tomas', 'Le damos una secuencia de órdenes: avanzar una casilla, girar a la izquierda o a la derecha. Las hace en orden, sin saltearse ninguna.', { anim: 'talk' }),
    n('como2', 'tomas', 'Si choca, no pasa nada: revisamos la secuencia y probamos otra vez. Así se aprende acá.', {
      choices: [{ text: '¡Probemos!', next: 'go' }],
    }),
    n('go', 'tomas', 'La pista está sobre la mesa. Armá el programa y apretá «Ejecutar».', { effects: [go('robot')], next: END }),
  ),
  dlg(
    'tomas.retry',
    n('a', 'tomas', '¿Volvemos a la pista? El robot te está esperando.', {
      choices: [
        { text: 'Sí, otra vez.', next: 'go' },
        { text: 'En un rato.', next: END },
      ],
    }),
    n('go', 'tomas', '¡Eso! Probar, fallar y mejorar.', { effects: [go('robot')], next: END }),
  ),
  dlg(
    'tomas.after',
    ...withInterview(
      'tomas',
      '¿Viste cómo el error también enseña? Si querés, la impresora 3D tiene un llavero del 40 listo para imprimir.',
      '¡Claro! Preguntá.',
      [
        ['¿Qué es lo que más te gusta del Aula Maker?', 'Ver la cara de alguien cuando algo que diseñó, por fin, funciona. Ese segundo vale todo.'],
        ['¿Un consejo para los visitantes?', 'Que toquen, que pregunten y que se animen a equivocarse. Acá equivocarse es parte del plan.'],
      ],
    ),
  ),
  dlg(
    'sofi.maker',
    n('a', 'sofi', '¡Hola! Soy Sofi, también doy robótica acá. Mientras Abi prepara la pista, podemos mirar los kits y pensar qué instrucciones necesita el robot.', { anim: 'wave', next: END }),
  ),
  dlg(
    'graciela.intro',
    n('a', 'graciela', '¡Hola, corazón! ¿Vos sos quien arma el Recorrido 40? Me contaron.', { anim: 'wave' }),
    n('b', 'graciela', 'Para los visitantes queremos mostrar un almuerzo bien armado. ¿Me ayudás a preparar una bandeja con lo que hay en la línea de PRO FOOD?', {
      anim: 'talk',
      choices: [
        { text: '¡Sí, armemos la bandeja!', next: 'go' },
        { text: '¿Qué es una bandeja equilibrada?', next: 'eq' },
      ],
    }),
    n('eq', 'graciela', 'Que tenga de todo un poco: una comida principal, algo de verdura, agua y una fruta. Colores en el plato, ¿viste?', {
      choices: [{ text: '¡Entendido, vamos!', next: 'go' }],
    }),
    n('go', 'graciela', 'Elegí vos, que yo sirvo.', { effects: [go('menu')], next: END }),
  ),
  dlg(
    'graciela.after',
    ...withInterview('graciela', '¡Volvé cuando quieras! El comedor a la hora del almuerzo es una fiesta.', '¡Preguntá, corazón!', [
      ['¿Qué es lo que más te gusta de tu trabajo?', 'Ver el comedor lleno y escuchar las charlas en las mesas largas. Ese ruido es lindo.'],
      ['¿Qué no puede faltar en una buena bandeja?', '¡Agua fresca y algo de color! Y una sonrisa, que no cuesta nada.'],
    ]),
  ),
  dlg(
    'martin.escalera',
    n('a', 'martin', '¡Hola! Soy Martín, preceptor de secundaria. Bajé con la campana: me dijeron que tenés el Pasaporte 40.', { anim: 'wave' }),
    n('b', 'martin', 'Arriba está el nivel secundario: el pasillo de los trofeos, la Secretaría, las aulas, los lockers y el sector nuevo con la biblioteca y el aula bilingüe.', {
      anim: 'talk',
      choices: [
        { text: '¿Me abrís la escalera?', next: 'abre' },
        { text: '¿Qué hay en el pasillo de los trofeos?', next: 'tro' },
      ],
    }),
    n('tro', 'martin', 'Una vitrina llena de trofeos, sobre el dispenser de agua. Lola armó ahí una trivia para los visitantes.', { next: 'abre' }),
    n('abre', 'martin', 'Listo, saco la cinta. Es el «Acceso al Nivel Secundario». Después pasá por la Preceptoría, que te espero.', {
      anim: 'point',
      effects: [done('c1.martin'), { do: 'unlock', zone: 'primerPiso' }],
      next: END,
    }),
  ),

  // ============================================================ capítulo 2
  dlg(
    'martin.preceptoria',
    n('a', 'martin', '¡Llegaste a la Preceptoría de secundaria! Acá organizamos la asistencia, los horarios y las salidas.', { anim: 'wave' }),
    n('b', 'martin', 'Para el acto, la Profe Ana preparó una coreografía en el aula de danzas del segundo piso. Se sube por la escalera de chapa del edificio de bloque: «Acceso a segundo piso».', {
      anim: 'talk',
    }),
    n('c', 'martin', 'Te habilito el paso. Cruzá por la pasarela vidriada, que es lo más lindo del piso.', {
      anim: 'point',
      effects: [done('c2.martin'), { do: 'unlock', zone: 'segundoPiso' }],
      next: END,
    }),
  ),
  dlg(
    'martin.after',
    ...withInterview('martin', '¿Cómo va ese pasaporte? Cualquier cosa, estoy en la Preceptoría.', '¡Dale!', [
      ['¿Qué es lo que más te gusta de ser preceptor?', 'Conocer a cada estudiante por su nombre. Un «¿cómo estás?» a tiempo cambia un día.'],
      ['¿Cómo describirías el nivel secundario?', 'Ruidoso en los recreos, concentrado en las pruebas y con muchas ganas de opinar. Me encanta.'],
    ]),
  ),
  dlg(
    'ana.salon',
    n('a', 'ana', '¡Hola! Este es el Salón de los espejos. La coreografía del acto la ensayamos arriba, en el aula de danzas del segundo piso.', { anim: 'wave' }),
    n('b', 'ana', 'Cuando llegues al nivel secundario, pedile a Martín que te habilite la escalera de chapa. ¡Te espero!', { next: END }),
  ),
  dlg(
    'ana.intro',
    n('a', 'ana', '¡Llegaste al aula de danzas! Por las ventanas con malla se ve el polideportivo desde arriba.', { anim: 'wave' }),
    n('b', 'ana', 'Para el acto armamos una secuencia de pasos. Yo te la muestro y vos la repetís, en el mismo orden. ¿Te animás?', {
      anim: 'talk',
      choices: [
        { text: '¡Me animo!', next: 'go' },
        { text: '¿Y si me equivoco?', next: 'error' },
      ],
    }),
    n('error', 'ana', 'Te la muestro otra vez. Bailar es repetir hasta que el cuerpo se acuerda solo.', { choices: [{ text: '¡Vamos!', next: 'go' }] }),
    n('go', 'ana', 'Cinco, seis, siete, ocho…', { anim: 'clap', effects: [go('danza')], next: END }),
  ),
  dlg(
    'ana.after',
    n('a', 'ana', '¡Qué bien bailaste! Nos vemos en el acto: primera fila.', { anim: 'clap', next: END }),
  ),
  dlg(
    'lola.hint',
    n('a', 'lola', '¿Seguimos? Ahora toca: {objetivo}. Llevamos {sellos} sellos.', { next: END }),
  ),

  // ============================================================ capítulo 3
  dlg(
    'laura.aula',
    n('a', 'laura', '¡Hola! Esta es un aula de primaria: pizarra blanca, pizarrón y el proyector en la viga.', { anim: 'wave' }),
    n('b', 'laura', 'Si querés, encendé el proyector: preparé una presentación para el aniversario.', { anim: 'point', next: END }),
  ),
  dlg(
    'laura.simulacro',
    n('a', 'laura', '¡Justo a tiempo! Para el aniversario también mostramos cómo nos cuidamos: hoy hacemos un simulacro de evacuación.', { anim: 'talk' }),
    n('b', 'laura', '¿Viste el plano de evacuación del hall? Marca las salidas en verde y el punto de encuentro: la esquina de Laprida y Miguel Cané. Te lo anoto en la pizarra.', {
      anim: 'write',
      effects: [{ do: 'script', id: 'pizarraSimulacro' }],
      choices: [
        { text: '¿Qué hago cuando suene la alarma?', next: 'como' },
        { text: '¡Estoy listo!', next: 'go' },
      ],
    }),
    n('como', 'laura', 'Dejás todo, salís caminando, sin correr ni empujar, y seguís las flechas verdes del piso hasta el punto de encuentro.'),
    n('go', 'laura', 'Ahí va la alarma. ¡Seguí las flechas verdes!', {
      anim: 'point',
      effects: [done('c3.laura'), { do: 'phase', phase: 'salida' }, { do: 'script', id: 'simulacro' }],
      next: END,
    }),
  ),
  dlg(
    'laura.encuentro',
    n('a', 'laura', '¡Muy bien! Llegaste caminando y sin empujar. Así se hace.', { anim: 'clap', next: END }),
  ),
  dlg(
    'ines.encuentro',
    n('a', 'ines', '¡Excelente! Todos afuera, en orden y en el punto de encuentro. Así se hace un simulacro.', { anim: 'clap' }),
    n('b', 'ines', 'Ahora te toca una visita especial: el Jardín de infantes CIMPID. La Seño Caro te espera en la recepción del jardín.', { anim: 'talk' }),
    n('c', 'ines', 'Se entra por la puerta del pasillo del gimnasio, la del cartel del jardín.', {
      anim: 'point',
      effects: [done('c3.ines'), { do: 'unlock', zone: 'jardin' }, { do: 'phase', phase: 'clase' }],
      next: END,
    }),
  ),

  // ============================================================ capítulo 4
  dlg(
    'caro.intro',
    n('a', 'caro', '¡Hola, hola! Bienvenido al jardín. Los chicos de las salas te prepararon una sorpresa para el aniversario.', { anim: 'wave' }),
    n('b', 'caro', 'Escondieron tres estrellas: una en la Sala Amarilla, junto a la casita de madera; otra en la Sala Rosa, la del castillo; y otra en la Sala Roja, la de la carpa de circo.', {
      anim: 'talk',
    }),
    n('c', 'caro', 'La Amarilla está acá, en planta baja; la Rosa y la Roja, en el primer piso. ¿Las encontrás?', {
      anim: 'point',
      effects: [done('c4.caro')],
      next: END,
    }),
  ),
  dlg(
    'caro.buscando',
    n('a', 'caro', '¿Y las estrellas? Fijate arriba de cada casita: la Amarilla acá abajo, la Rosa y la Roja arriba.', { anim: 'point', next: END }),
  ),
  dlg(
    'caro.final',
    n('a', 'caro', '¡Las tres! Cada estrella tiene un dibujo de su sala.', { anim: 'clap' }),
    n('b', 'caro', 'Con ellas armamos el cartel del jardín para el acto. Los chicos ya se están preparando.', { effects: [done('c4.volver')] }),
    n('c', 'caro', 'Si querés, subí al SUM a ver el escenario, o al Espacio de música. ¡Nos vemos en el Polideportivo!', { anim: 'wave', next: END }),
  ),
  dlg(
    'caro.after',
    ...withInterview('caro', '¡Gracias por venir al jardín! Los chicos no paran de hablar de vos.', '¡Uy, una entrevista! Dale.', [
      ['¿Qué es lo más lindo del jardín?', 'Las preguntas. Un chico de cuatro años te hace pensar más que cualquier libro.'],
      ['¿Qué sala elegirías?', '¡Todas! Pero la carpa de la Sala Roja tiene algo mágico.'],
    ]),
  ),

  // ============================================================ capítulo 5
  dlg(
    'juli.antes',
    n('a', 'juli', '¡Hola! Acá en el Polideportivo se juega al handball, se hacen los actos y se grita mucho.', { anim: 'wave' }),
    n('b', 'juli', 'Volvé para el final del recorrido, que te preparo algo.', { next: END }),
  ),
  dlg(
    'juli.intro',
    n('a', 'juli', '¡Llegó la figura del día! Antes del acto hacemos una muestra de handball.', { anim: 'wave' }),
    n('b', 'juli', 'Tres lanzamientos desde la línea de siete metros, y Lola al arco. Elegí a dónde tirar… ¡y que no te lea la mirada!', {
      anim: 'point',
      choices: [
        { text: '¡A lanzar!', next: 'go' },
        { text: '¿Cómo es un penal en handball?', next: 'como' },
      ],
    }),
    n('como', 'juli', 'Se lanza con la mano, desde siete metros y sin pisar la línea. La arquera puede moverse para atajar.', { choices: [{ text: '¡Listo!', next: 'go' }] }),
    n('go', 'juli', '¡Silbato!', { effects: [go('penales')], next: END }),
  ),
  dlg(
    'juli.after',
    ...withInterview('juli', '¡Bien ahí! Andá a tu lugar, que el acto está por empezar.', '¡Disparale!', [
      ['¿Por qué handball?', 'Porque nadie gana solo: hay que pasarla, moverse y confiar en el equipo.'],
      ['¿Qué es lo mejor del Polideportivo?', 'El ruido de las gradas en un partido. Retumba en toda la bóveda.'],
    ]),
  ),
  dlg(
    'ines.acto',
    n('a', 'ines', 'Buenas tardes a todas y a todos. Hoy celebramos los 40 años de la escuela.', { anim: 'talk' }),
    n('b', 'ines', 'Hoy alguien recorrió cada rincón para armar el Recorrido 40: el Aula Maker, la cantina, los patios, el nivel secundario, el aula de danzas y el jardín.', { anim: 'point' }),
    n('c', 'ines', 'Te invito a decir unas palabras. ¿Qué querés destacar?', {
      choices: [
        { text: 'Las personas: cada una me enseñó algo.', next: 'cierre', effects: [{ do: 'choice', key: 'discurso', value: 'personas' }] },
        { text: 'Los espacios para crear, jugar y aprender.', next: 'cierre', effects: [{ do: 'choice', key: 'discurso', value: 'espacios' }] },
        { text: 'Que acá nos cuidamos entre todos.', next: 'cierre', effects: [{ do: 'choice', key: 'discurso', value: 'cuidado' }] },
      ],
    }),
    n('cierre', 'ines', 'Gracias. Eso es lo que hace a esta escuela: 40 años construyendo, entre todos, la mejor escuela.', {
      anim: 'clap',
      effects: [done('c5.palabras')],
      next: END,
    }),
  ),
  dlg(
    'ines.fin',
    n('a', 'ines', '¡Gracias por el Recorrido 40! La escuela queda abierta: seguí explorando cuando quieras.', { anim: 'wave', next: END }),
  ),

  // ========================================================== entrevistas
  dlg(
    'ruben.after',
    ...withInterview('ruben', 'Cualquier cosa, estoy en el portal. De acá se ve toda Laprida.', '¡Dale! Preguntá nomás.', [
      ['¿Qué es lo primero que ves cada mañana?', 'Las familias llegando por Laprida, las mochilas, los saludos. Abrir el portón es como abrir el día.'],
      ['¿Cuál es tu rincón favorito?', 'El hall, cuando entra el sol por la puerta. El mural de San Martín se ve distinto a cada hora.'],
    ]),
  ),
];

export function dialogue(id: string): DialogueDef | undefined {
  return DIALOGUES.find((d) => d.id === id);
}

/** Qué conversación abre cada personaje: la primera regla que se cumple. */
export const TALK: Readonly<Record<string, readonly TalkRule[]>> = {
  ruben: [{ when: (q) => q.available('p.portero'), dialogue: 'ruben.intro' }, { dialogue: 'ruben.after' }],
  ines: [
    { when: (q) => q.available('p.directora'), dialogue: 'ines.intro' },
    { when: (q) => !q.done('p.directora'), dialogue: 'ines.mural' },
    { when: (q) => q.available('c3.ines'), dialogue: 'ines.encuentro' },
    { when: (q) => q.available('c5.palabras'), dialogue: 'ines.acto' },
    { when: (q) => q.done('c5.palabras'), dialogue: 'ines.fin' },
    { dialogue: 'ines.hub' },
  ],
  lola: [{ dialogue: 'lola.hint' }],
  tomas: [
    { when: (q) => q.available('c1.maker') && !q.flag('robotExplicado'), dialogue: 'tomas.intro' },
    { when: (q) => q.available('c1.maker'), dialogue: 'tomas.retry' },
    { when: (q) => q.done('c1.maker'), dialogue: 'tomas.after' },
  ],
  sofi: [{ dialogue: 'sofi.maker' }],
  graciela: [{ when: (q) => q.available('c1.cantina'), dialogue: 'graciela.intro' }, { when: (q) => q.done('c1.cantina'), dialogue: 'graciela.after' }],
  martin: [
    { when: (q) => q.available('c1.martin'), dialogue: 'martin.escalera' },
    { when: (q) => q.available('c2.martin'), dialogue: 'martin.preceptoria' },
    { when: (q) => q.done('c2.martin'), dialogue: 'martin.after' },
  ],
  ana: [
    { when: (q) => q.available('c2.danza'), dialogue: 'ana.intro' },
    { when: (q) => q.done('c2.danza'), dialogue: 'ana.after' },
    { dialogue: 'ana.salon' },
  ],
  laura: [
    { when: (q) => q.available('c3.laura'), dialogue: 'laura.simulacro' },
    { when: (q) => q.done('c3.laura') && !q.done('c3.ines'), dialogue: 'laura.encuentro' },
    { dialogue: 'laura.aula' },
  ],
  caro: [
    { when: (q) => q.available('c4.caro'), dialogue: 'caro.intro' },
    { when: (q) => q.available('c4.volver'), dialogue: 'caro.final' },
    { when: (q) => q.available('c4.estrellas'), dialogue: 'caro.buscando' },
    { when: (q) => q.done('c4.volver'), dialogue: 'caro.after' },
  ],
  juli: [
    { when: (q) => q.available('c5.juli'), dialogue: 'juli.intro' },
    { when: (q) => q.done('c5.juli'), dialogue: 'juli.after' },
    { dialogue: 'juli.antes' },
  ],
};

/** Comentarios de Lola la primera vez que se entra a cada lugar. */
export const BARKS: Readonly<Record<string, string>> = {
  hall: '¡Mirá el mural de San Martín! Ese lema lo sabemos todos de memoria.',
  maker: 'El Aula Maker… ¡la cortadora láser, la impresora 3D, los Educabot! Quiero todo.',
  cantina: 'Huele rico. ¿Será la hora del almuerzo?',
  patioOeste: 'La palmera del Espacio recreativo. Acá nos juntamos en el recreo.',
  patioEste: 'Los juegos, los aviarios, las hamacas… ¡acá jugaba cuando estaba en primaria!',
  gimnasio: 'El Polideportivo. ¡Mirá la bandera con el escudo en el fondo!',
  salon: 'El Salón de los espejos. Siempre me miro de reojo cuando paso.',
  trofeos: '¡La vitrina de los trofeos! Armé una trivia para los visitantes, ¿la probás?',
  lockers: 'Los lockers de colores… el mío es el del medio.',
  pasarela: 'La pasarela vidriada: desde acá se ve todo el patio de juegos.',
  biblioteca: 'Shh… la biblioteca. El fichero rojo es un clásico.',
  danzas: '¡El aula de danzas! Está justo debajo de la bóveda del polideportivo.',
  jardin: '¡El jardín! Todo es chiquito y de colores.',
  sum: 'El escenario del SUM, con telón rojo. ¡Qué lindo!',
  encuentro: 'El punto de encuentro: esquina de Laprida y Miguel Cané.',
  bloque: 'El edificio de bloque: columnas rojas y la escalera de chapa.',
  sectorNuevo: 'El sector nuevo: cerámico clarito y la mesada de venecitas.',
};
