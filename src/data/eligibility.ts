// Test de elegibilidad para donar sangre (20 preguntas).
// Es una guía de autoorientación basada en criterios habituales de selección de donantes.
// No sustituye la entrevista ni el examen médico del banco de sangre, que son los que deciden.

export interface Option {
  label: string;
  eligible: boolean;
  /** Motivo de diferimiento (solo si eligible es false). */
  reasonTitle?: string;
  medicalReason?: string;
  timeframe?: string;
  /** Aviso para opciones aptas que conviene comentar en la entrevista. */
  note?: string;
}

export interface Question {
  id: number;
  category: CategoryId;
  title: string;
  description: string;
  options: Option[];
}

export type CategoryId = 'basicos' | 'salud' | 'procedimientos' | 'regionales' | 'antecedentes' | 'riesgo';

export const categories: { id: CategoryId; label: string }[] = [
  { id: 'basicos', label: 'Requisitos básicos' },
  { id: 'salud', label: 'Salud y medicamentos recientes' },
  { id: 'procedimientos', label: 'Procedimientos y embarazo' },
  { id: 'regionales', label: 'Viajes y enfermedades de la región' },
  { id: 'antecedentes', label: 'Antecedentes médicos' },
  { id: 'riesgo', label: 'Conductas de riesgo' },
];

export const questions: Question[] = [
  // ----- Requisitos básicos -----
  {
    id: 1,
    category: 'basicos',
    title: "¿Cuál es tu edad actual?",
    description: "Parámetro establecido para garantizar la madurez cardiovascular del donante.",
    options: [
      { label: "Tengo entre 18 y 65 años", eligible: true },
      {
        label: "Tengo menos de 18 años",
        eligible: false,
        reasonTitle: "Minoría de edad",
        medicalReason: "El sistema circulatorio y la masa sanguínea total en personas menores de 18 años continúan en fase de desarrollo. La extracción de volumen estándar puede provocar hipotensión grave.",
        timeframe: "Diferido hasta cumplir los 18 años de edad.",
      },
      {
        label: "Tengo más de 65 años",
        eligible: false,
        reasonTitle: "Límite de edad superior",
        medicalReason: "En adultos mayores de 65 años, la pérdida de volumen hemático puede comprometer el riego sanguíneo a órganos vitales. Se requiere una valoración clínica presencial previa.",
        timeframe: "Sujeto a autorización médica especializada.",
      },
    ],
  },
  {
    id: 2,
    category: 'basicos',
    title: "¿Cuál es tu peso corporal aproximado?",
    description: "Determina si el volumen de sangre extraído es proporcionalmente seguro para tu organismo.",
    options: [
      { label: "Peso 50 kg (110 lbs) o más", eligible: true },
      {
        label: "Peso menos de 50 kg (110 lbs)",
        eligible: false,
        reasonTitle: "Peso corporal insuficiente",
        medicalReason: "La bolsa de donación recolecta un volumen estándar de 450 ml. En personas de menos de 50 kg, este volumen representa un porcentaje elevado de su volemia total, incrementando el riesgo de desmayo o shock hipovolémico.",
        timeframe: "Diferido hasta alcanzar el peso mínimo regulatorio.",
      },
    ],
  },
  {
    id: 3,
    category: 'basicos',
    title: "¿Dormiste al menos 6 horas anoche y comiste algo en las últimas 4 horas?",
    description: "Donar en ayunas o sin descanso aumenta el riesgo de mareos durante la extracción.",
    options: [
      { label: "Sí, descansé y comí algo ligero", eligible: true },
      {
        label: "No, dormí poco o estoy en ayunas",
        eligible: false,
        reasonTitle: "Descanso o alimentación insuficiente",
        medicalReason: "La extracción reduce por un momento el volumen de sangre circulante. Sin descanso ni alimento, la probabilidad de bajada de tensión y desmayo aumenta de forma importante.",
        timeframe: "Puedes donar otro día, tras dormir bien y comer algo ligero y sin grasa.",
      },
    ],
  },
  {
    id: 4,
    category: 'basicos',
    title: "¿Consumiste bebidas alcohólicas en las últimas 24 horas?",
    description: "El alcohol deshidrata y reduce la tolerancia del cuerpo a la extracción.",
    options: [
      { label: "No he bebido alcohol en las últimas 24 horas", eligible: true },
      {
        label: "Sí, bebí alcohol en las últimas 24 horas",
        eligible: false,
        reasonTitle: "Consumo reciente de alcohol",
        medicalReason: "El alcohol produce deshidratación y dilata los vasos sanguíneos, lo que favorece mareos y desmayos después de donar.",
        timeframe: "Espera al menos 24 horas sin consumir alcohol.",
      },
    ],
  },
  {
    id: 5,
    category: 'basicos',
    title: "¿Cuándo realizaste tu última donación de sangre?",
    description: "El organismo requiere un lapso de tiempo para reponer los depósitos de hierro y glóbulos rojos.",
    options: [
      { label: "Hace más de 3 meses (o es mi primera vez)", eligible: true },
      {
        label: "Hace menos de 3 meses",
        eligible: false,
        reasonTitle: "Intervalo de recuperación incompleto",
        medicalReason: "La regeneración total de los eritrocitos (glóbulos rojos) requiere entre 8 y 12 semanas. Donar antes de este periodo puede inducir anemia ferropénica en el donante.",
        timeframe: "Esperar al menos 3 meses desde la última donación (4 meses en el caso de las mujeres).",
      },
    ],
  },

  // ----- Salud y medicamentos recientes -----
  {
    id: 6,
    category: 'salud',
    title: "¿Has presentado fiebre, gripe o síntomas virales en las últimas 2 semanas?",
    description: "Garantiza que la unidad extraída esté libre de agentes infecciosos activos.",
    options: [
      { label: "No, me he sentido completamente sano", eligible: true },
      {
        label: "Sí, he presentado fiebre, tos u otros síntomas virales",
        eligible: false,
        reasonTitle: "Cuadro viral o infeccioso reciente",
        medicalReason: "Durante un cuadro infeccioso existe presencia temporal de virus o bacterias en la circulación sanguínea. Transfundir esta unidad a un paciente crítico puede causarle complicaciones severas.",
        timeframe: "Diferido por 14 días tras la resolución total de los síntomas.",
      },
    ],
  },
  {
    id: 7,
    category: 'salud',
    title: "¿Tuviste dengue, zika o chikungunya en las últimas 4 semanas?",
    description: "Son enfermedades transmitidas por mosquitos, frecuentes en el Zulia, que pueden pasar por la sangre.",
    options: [
      { label: "No, o ya pasaron más de 4 semanas desde que me recuperé", eligible: true },
      {
        label: "Sí, o todavía tengo síntomas",
        eligible: false,
        reasonTitle: "Dengue, zika o chikungunya reciente",
        medicalReason: "Estos virus pueden seguir en la sangre después de que desaparecen los síntomas y transmitirse al paciente por transfusión.",
        timeframe: "Diferido 4 semanas tras la recuperación completa. El banco puede indicar un plazo mayor.",
      },
    ],
  },
  {
    id: 8,
    category: 'salud',
    title: "¿Has tomado medicamentos antibióticos en los últimos 14 días?",
    description: "Evita la transferencia residual de fármacos a pacientes receptores.",
    options: [
      { label: "No he consumido antibióticos recientemente", eligible: true },
      {
        label: "Sí, he finalizado un tratamiento antibiótico en los últimos 14 días",
        eligible: false,
        reasonTitle: "Tratamiento antibiótico reciente",
        medicalReason: "La presencia de trazas de antibióticos en la sangre donada puede desencadenar reacciones alérgicas o interferir con el tratamiento farmacológico del paciente receptor.",
        timeframe: "Diferido por 14 días posteriores a la última dosis del medicamento.",
      },
    ],
  },
  {
    id: 9,
    category: 'salud',
    title: "¿Tomas anticoagulantes, isotretinoína (para el acné), finasterida o dutasterida?",
    description: "Algunos fármacos pasan a la sangre donada y pueden dañar al receptor, sobre todo a pacientes embarazadas.",
    options: [
      { label: "No tomo ninguno de estos medicamentos", eligible: true },
      {
        label: "Sí, tomo o tomé alguno recientemente",
        eligible: false,
        reasonTitle: "Medicamento que requiere espera",
        medicalReason: "La isotretinoína, la finasterida y la dutasterida pueden causar malformaciones si llegan a una paciente embarazada. Los anticoagulantes alteran la coagulación de la unidad y aumentan el sangrado en el punto de punción.",
        timeframe: "Depende del fármaco: 1 mes tras la última dosis de isotretinoína o finasterida, 6 meses para la dutasterida. Con anticoagulantes, consulta en el banco de sangre.",
      },
    ],
  },
  {
    id: 10,
    category: 'salud',
    title: "¿Te pusiste alguna vacuna en las últimas 4 semanas?",
    description: "Las vacunas de virus vivos requieren un tiempo de espera; la mayoría de las demás, no.",
    options: [
      { label: "No, o fue una vacuna inactivada (gripe, COVID-19, tétanos)", eligible: true },
      {
        label: "Sí, de virus vivos (fiebre amarilla, sarampión, rubéola, varicela)",
        eligible: false,
        reasonTitle: "Vacuna de virus vivos atenuados",
        medicalReason: "Estas vacunas contienen virus debilitados que circulan brevemente en la sangre. En un paciente con las defensas bajas podrían causar la infección.",
        timeframe: "Entre 2 y 4 semanas desde la vacunación, según la vacuna.",
      },
    ],
  },

  // ----- Procedimientos y embarazo -----
  {
    id: 11,
    category: 'procedimientos',
    title: "¿Te has realizado alguna extracción dental o cirugía bucal en la última semana?",
    description: "Previene el ingreso accidental de bacterias bucales a la bolsa de donación.",
    options: [
      { label: "No he tenido intervenciones dentales invasivas en los últimos 7 días", eligible: true },
      {
        label: "Sí, me realizaron una extracción dental o cirugía oral reciente",
        eligible: false,
        reasonTitle: "Bacteriemia transitoria bucal",
        medicalReason: "Los procedimientos odontológicos invasivos permiten que bacterias normales de la boca ingresen temporalmente al torrente sanguíneo. La sangre extraída durante este periodo no se considera biológicamente estéril.",
        timeframe: "Diferido por 7 días tras el procedimiento (o 14 días si requirió antibióticos).",
      },
    ],
  },
  {
    id: 12,
    category: 'procedimientos',
    title: "¿Te has realizado algún tatuaje, piercing o maquillaje permanente en los últimos 12 meses?",
    description: "Periodo de ventana inmunológica necesario para descartar infecciones parenterales.",
    options: [
      { label: "No me he realizado ninguno de estos procedimientos en el último año", eligible: true },
      {
        label: "Sí, me realicé un tatuaje, piercing o procedimiento similar en los últimos 12 meses",
        eligible: false,
        reasonTitle: "Periodo de ventana inmunológica",
        medicalReason: "Las perforaciones cutáneas representan una vía potencial de transmisión de virus como Hepatitis B, Hepatitis C y VIH. Es necesario esperar 12 meses para que las pruebas analíticas de laboratorio sean 100% fiables.",
        timeframe: "Diferido por 12 meses contados a partir de la fecha de realización.",
      },
    ],
  },
  {
    id: 13,
    category: 'procedimientos',
    title: "¿Has sido sometido a una cirugía mayor o recibido una transfusión de sangre en el último año?",
    description: "Evaluación de procedimientos quirúrgicos previos y uso de hemoderivados.",
    options: [
      { label: "No he tenido cirugías mayores ni transfusiones en los últimos 12 meses", eligible: true },
      {
        label: "Sí, tuve una intervención quirúrgica mayor o recibí sangre",
        eligible: false,
        reasonTitle: "Antecedente quirúrgico o transfusional reciente",
        medicalReason: "Las intervenciones quirúrgicas consumen reservas hematológicas significativas. Asimismo, haber recibido una transfusión exige un año de espera para descartar el desarrollo de anticuerpos irregulares.",
        timeframe: "Diferido por 12 meses desde el alta médica o transfusión.",
      },
    ],
  },
  {
    id: 14,
    category: 'procedimientos',
    title: "¿Estás embarazada, das lactancia o tuviste un parto o una pérdida en los últimos 6 meses?",
    description: "Aplica a personas que pueden gestar. Si no es tu caso, elige la primera opción.",
    options: [
      { label: "No, o no aplica en mi caso", eligible: true },
      {
        label: "Sí",
        eligible: false,
        reasonTitle: "Embarazo, lactancia o posparto",
        medicalReason: "Durante el embarazo y la lactancia el cuerpo necesita todas sus reservas de hierro y de sangre. Donar en esta etapa puede causar anemia en la madre y afectar al bebé.",
        timeframe: "Diferido durante el embarazo y la lactancia, y al menos 6 meses después del parto o la pérdida.",
      },
    ],
  },

  // ----- Viajes y enfermedades de la región -----
  {
    id: 15,
    category: 'regionales',
    title: "¿Has viajado a zonas selváticas o de alto riesgo de malaria en los últimos 6 meses?",
    description: "Verificación epidemiológica por enfermedades vectoriales transmisibles por sangre.",
    options: [
      { label: "No he visitado zonas endémicas de malaria o paludismo", eligible: true },
      {
        label: "Sí, he permanecido en zonas de riesgo en los últimos 6 meses",
        eligible: false,
        reasonTitle: "Riesgo epidemiológico por zonas endémicas",
        medicalReason: "El parásito causante de la malaria (Plasmodium) puede habitar de forma asintomática en los glóbulos rojos durante meses. La transfusión de esta sangre infectará al receptor.",
        timeframe: "Diferido por 6 meses tras abandonar la zona de riesgo.",
      },
    ],
  },
  {
    id: 16,
    category: 'regionales',
    title: "¿Te han diagnosticado enfermedad de Chagas o viviste en una casa rural con chipos?",
    description: "El Chagas, transmitido por el chipo, está presente en zonas rurales de Venezuela.",
    options: [
      { label: "No, nunca", eligible: true },
      {
        label: "Estuve expuesto al chipo, pero no tengo diagnóstico",
        eligible: true,
        note: "Coméntalo en la entrevista: el banco de sangre puede hacerte una prueba específica de Chagas antes de aceptar la donación.",
      },
      {
        label: "Sí, tengo diagnóstico de Chagas",
        eligible: false,
        reasonTitle: "Enfermedad de Chagas",
        medicalReason: "El parásito Trypanosoma cruzi puede permanecer en la sangre durante años sin dar síntomas y transmitirse por transfusión.",
        timeframe: "Diferimiento permanente.",
      },
    ],
  },

  // ----- Antecedentes médicos -----
  {
    id: 17,
    category: 'antecedentes',
    title: "¿Padeces alguna enfermedad crónica como diabetes, hipertensión, epilepsia, cáncer o problemas de coagulación?",
    description: "Muchas condiciones controladas permiten donar; otras requieren valoración médica.",
    options: [
      { label: "No padezco ninguna", eligible: true },
      {
        label: "Sí, hipertensión o diabetes controladas con pastillas y sin complicaciones",
        eligible: true,
        note: "Lleva el nombre de tus medicamentos. El médico confirmará que tu presión y tu glucosa estén en rango el día de la donación.",
      },
      {
        label: "Sí, uso insulina, tuve cáncer, convulsiones o un trastorno de coagulación",
        eligible: false,
        reasonTitle: "Enfermedad crónica que requiere valoración",
        medicalReason: "Estas condiciones pueden descompensarse con la pérdida de volumen sanguíneo o afectar la seguridad de la unidad donada. En algunos casos la donación es posible, pero solo tras una valoración especializada.",
        timeframe: "Sujeto a evaluación médica presencial.",
      },
    ],
  },
  {
    id: 18,
    category: 'antecedentes',
    title: "¿Padeces o has padecido Hepatitis B, Hepatitis C, VIH o enfermedades cardíacas graves?",
    description: "Criterios de exclusión permanente para proteger la salud del donante y del receptor.",
    options: [
      { label: "No padezco ninguna de estas patologías", eligible: true },
      {
        label: "Sí, diagnóstico confirmado de alguna de estas condiciones",
        eligible: false,
        reasonTitle: "Exclusión sanitaria permanente",
        medicalReason: "Estas afecciones virales se mantienen en el plasma o tejidos del donante de forma crónica, garantizando la transmisión de la patología al receptor. En el caso de afecciones cardíacas, la donación implica un riesgo alto de descompensación.",
        timeframe: "Diferimiento permanente según normativa internacional de transfusiones.",
      },
    ],
  },

  // ----- Conductas de riesgo -----
  {
    id: 19,
    category: 'riesgo',
    title: "En los últimos 12 meses, ¿tuviste relaciones sexuales sin preservativo con parejas nuevas u ocasionales?",
    description: "Se pregunta a todas las personas por igual. Detecta riesgos que los análisis todavía no pueden ver.",
    options: [
      { label: "No", eligible: true },
      {
        label: "Sí",
        eligible: false,
        reasonTitle: "Conducta sexual de riesgo reciente",
        medicalReason: "Algunas infecciones, como el VIH o la hepatitis B, tienen un periodo de ventana en el que las pruebas de laboratorio aún no las detectan, aunque ya puedan transmitirse por transfusión.",
        timeframe: "Diferido 12 meses desde la última exposición, según la normativa local. El banco te indicará el plazo exacto.",
      },
    ],
  },
  {
    id: 20,
    category: 'riesgo',
    title: "¿Alguna vez te has inyectado drogas o sustancias no recetadas por un médico?",
    description: "Incluye esteroides o productos para aumentar la masa muscular.",
    options: [
      { label: "No, nunca", eligible: true },
      {
        label: "Sí, al menos una vez",
        eligible: false,
        reasonTitle: "Uso de sustancias inyectadas",
        medicalReason: "Compartir o reutilizar agujas es una de las principales vías de transmisión del VIH y de las hepatitis B y C.",
        timeframe: "Diferimiento permanente según normativa internacional de transfusiones.",
      },
    ],
  },
];
