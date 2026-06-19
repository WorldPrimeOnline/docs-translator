import type { LegalDocs } from '../types';

const LP = 'En caso de discrepancia entre la versión rusa de este documento y sus traducciones a otros idiomas, prevalecerá la versión rusa, salvo que el Proveedor indique expresamente lo contrario.';

export const legalDocs: LegalDocs = {
  offer: {
    slug: 'offer',
    title: 'Oferta Pública de Servicios',
    metaTitle: 'Contrato de Servicios — WorldPrimeOnline',
    metaDescription: 'Condiciones de uso de los servicios de la plataforma WorldPrimeOnline.',
    effectiveDate: '2026-05-26',
    sections: [
      {
        id: 'general',
        heading: '1. Disposiciones Generales',
        body: [
          'El presente documento constituye una oferta pública de WorldPrimeOnline (en adelante, el Proveedor) dirigida a los usuarios (en adelante, el Cliente) y establece los términos del contrato de servicios.',
          'Proveedor: IE WorldPrimeOnline',
          'IIN/BIN: 840324300155',
          'Dirección: Almaty',
          'Correo electrónico: worldprimeonline@gmail.com',
          'Teléfono: +7 701 136 63 76',
          'Sitio web: https://www.wpotranslations.org/',
          'IVA: no aplicable',
          'El registro en la plataforma o su uso implica la aceptación plena e incondicional de esta Oferta.',
          LP,
        ],
      },
      {
        id: 'definitions',
        heading: '2. Definiciones',
        body: [
          '• Proveedor: WorldPrimeOnline.',
          '• Cliente: cualquier persona que haya aceptado esta Oferta.',
          '• Servicio: servicios de traducción, localización y servicios lingüísticos conexos ofrecidos por el Proveedor.',
          '• Plataforma: la plataforma web disponible en https://www.wpotranslations.org/.',
          '• Pedido: la especificación técnica de trabajo enviada por el Cliente.',
        ],
      },
      {
        id: 'subject',
        heading: '3. Objeto del Contrato',
        body: [
          'El Proveedor presta servicios de traducción, localización y otros servicios lingüísticos conforme al pedido del Cliente.',
          'El tipo, el alcance y el precio del servicio se determinan individualmente para cada pedido.',
          'El Proveedor podrá involucrar a especialistas de terceros para la prestación de los servicios.',
        ],
      },
      {
        id: 'order',
        heading: '4. Procedimiento de Pedido',
        body: [
          'El Cliente realiza el pedido a través de la plataforma y envía los materiales e información necesarios.',
          'Una vez confirmado el pedido por el Proveedor, se confirman el plazo y el precio.',
          'El Cliente está obligado a proporcionar instrucciones claras y a garantizar que sus materiales están listos para la traducción.',
          'Si las especificaciones cambian, el plazo y el precio se confirman de nuevo.',
        ],
      },
      {
        id: 'payment',
        heading: '5. Condiciones de Pago',
        body: [
          'El precio del servicio se fija antes o durante la realización del pedido.',
          'Los métodos de pago disponibles se muestran en la página de pago.',
          'No se realizarán reembolsos una vez prestado el servicio, salvo en los casos previstos en la sección 6.',
          'El Cliente asume los costes de suscripción de plataformas de terceros necesarias para el uso del servicio.',
        ],
      },
      {
        id: 'delivery',
        heading: '6. Prestación y Entrega del Servicio',
        body: [
          'El plazo comienza a correr desde la confirmación del pedido.',
          'Las traducciones finalizadas se entregan a través de la plataforma; el Cliente debe revisar los documentos recibidos.',
          'El Cliente podrá solicitar correcciones en un plazo de 3 (tres) días hábiles tras la recepción.',
          'Transcurrido dicho plazo, el pedido se considerará aceptado.',
        ],
      },
      {
        id: 'refund',
        heading: '7. Devoluciones',
        body: [
          'El procesamiento puede iniciarse automáticamente justo después de confirmar el pago. Una vez iniciados el OCR, la traducción, la generación del PDF o la transferencia a un traductor o notario socio, puede no ser posible cancelar el pedido.',
          'El reembolso total solo se realizará si el servicio no ha sido iniciado.',
          'En caso de error técnico imputable al Proveedor, este podrá efectuar un reprocesamiento gratuito. Si el reprocesamiento no es posible o no resuelve el error, se procederá al reembolso.',
          'Los errores del Cliente, la información incorrecta o el rechazo de terceros no constituyen motivo de reembolso.',
        ],
      },
      {
        id: 'accuracy',
        heading: '8. Calidad de la Traducción',
        body: [
          'El Proveedor se esfuerza por proporcionar una traducción de alta calidad basándose en el texto fuente aportado.',
          'La exactitud de la traducción no está garantizada por terceros (autoridades gubernamentales, consulados, etc.).',
          'El Cliente deberá revisar la traducción por su cuenta antes de enviarla a organismos oficiales.',
          'La terminología de los documentos especializados no se modificará sin acuerdo previo por escrito.',
        ],
      },
      {
        id: 'ip',
        heading: '9. Propiedad Intelectual',
        body: [
          'Los derechos de autor sobre los materiales fuente corresponden al Cliente.',
          'La traducción se transfiere al Cliente tras su finalización.',
          'El Proveedor conserva el derecho de mostrar la estructura del contenido sin publicar la traducción.',
        ],
      },
      {
        id: 'confidential',
        heading: '10. Confidencialidad',
        body: [
          'El Proveedor mantiene la confidencialidad de los materiales del Cliente.',
          'Los materiales solo se transmiten a terceros por requerimiento legal o cuando sea necesario para la prestación del servicio.',
          'Esta obligación permanece vigente tras la finalización del servicio.',
        ],
      },
      {
        id: 'liability',
        heading: '11. Limitación de Responsabilidad',
        body: [
          'La responsabilidad del Proveedor se limita al importe pagado por el pedido.',
          'El Proveedor no asume responsabilidad por rechazos de terceros, retrasos o perjuicios derivados de decisiones de organismos públicos.',
          'El Proveedor no ofrece garantías de idoneidad para fines específicos.',
          'El Proveedor no asume responsabilidad por pedidos no ejecutados por causa de fuerza mayor.',
        ],
      },
      {
        id: 'thirdparty',
        heading: '12. Servicios de Terceros',
        body: [
          'El Proveedor podrá utilizar especialistas, herramientas o software de terceros durante la prestación del servicio.',
          'El Proveedor no se responsabiliza de todas las acciones y decisiones de dichos terceros.',
          'Los honorarios de los servicios de terceros se facturan por separado y conforme a sus condiciones.',
        ],
      },
      {
        id: 'termination',
        heading: '13. Resolución del Contrato',
        body: [
          'El Cliente puede cancelar el pedido antes de que comience el servicio; en ese caso, se facturarán los trabajos ya realizados.',
          'El Proveedor podrá resolver el contrato sin previo aviso si el Cliente incumple las condiciones.',
        ],
      },
      {
        id: 'changes',
        heading: '14. Modificaciones de la Oferta',
        body: [
          'El Proveedor podrá modificar el presente documento en cualquier momento.',
          'El documento modificado entrará en vigor desde su publicación en la plataforma.',
          'El uso continuado de la plataforma por parte del Cliente implica la aceptación de las nuevas condiciones.',
        ],
      },
      {
        id: 'dispute',
        heading: '15. Resolución de Disputas',
        body: [
          'Las partes intentarán resolver las disputas en primer lugar mediante negociación mutua.',
          'En caso de no alcanzar un acuerdo, la disputa se resolverá conforme a la legislación de Kazajistán.',
          'El Cliente presentará la reclamación ante el tribunal del lugar de registro del Proveedor.',
        ],
      },
      {
        id: 'contacts',
        heading: '16. Información de Contacto',
        body: [
          'WorldPrimeOnline',
          'Dirección: Almaty',
          'Correo electrónico: worldprimeonline@gmail.com',
          'Sitio web: https://www.wpotranslations.org/',
        ],
      },
    ],
  },

  privacy: {
    slug: 'privacy',
    title: 'Política de Privacidad',
    metaTitle: 'Política de Privacidad — WorldPrimeOnline',
    metaDescription: 'Cómo WorldPrimeOnline trata los datos personales de sus usuarios.',
    effectiveDate: '2026-05-26',
    sections: [
      {
        id: 'general',
        heading: '1. Disposiciones Generales',
        body: [
          'La presente Política de Privacidad explica cómo WorldPrimeOnline (en adelante, el Proveedor) recopila y trata los datos personales de los usuarios de la plataforma WorldPrimeOnline.',
          'El uso de la plataforma implica la aceptación de los términos de esta Política.',
          LP,
        ],
      },
      {
        id: 'collected',
        heading: '2. Datos Recopilados',
        body: [
          'Podemos recopilar los siguientes datos:',
          '• Datos proporcionados al registrarse: nombre, correo electrónico, teléfono.',
          '• Datos aportados al completar un pedido: documentos, instrucciones, información adicional.',
          '• Interacción con la plataforma: solicitudes de soporte, comentarios.',
          '• Datos técnicos: dirección IP, tipo de navegador, duración del uso.',
        ],
      },
      {
        id: 'use',
        heading: '3. Uso de los Datos',
        body: [
          'Los datos recopilados se utilizan para los siguientes fines:',
          '• Recibir, ejecutar y entregar pedidos.',
          '• Mejorar la calidad del servicio.',
          '• Comunicarse con el Cliente.',
          '• Cumplir con obligaciones legales.',
          '• Combatir el fraude y las actividades ilegales.',
        ],
      },
      {
        id: 'sharing',
        heading: '4. Cesión de Datos',
        body: [
          'No vendemos datos personales a terceros.',
          'Los datos solo podrán transferirse en los siguientes supuestos:',
          '• A especialistas que prestan el servicio (sujetos a obligación de confidencialidad).',
          '• A organismos públicos por requerimiento legal.',
          '• A servicios bancarios y de plataforma que procesan el pago.',
          '• Cuando se seleccione el nivel de Traducción Oficial o Notarización, los datos relevantes del documento podrán compartirse con los traductores, notarios u otros socios participantes en la prestación del servicio correspondiente, exclusivamente en la medida necesaria para ejecutar el encargo.',
        ],
      },
      {
        id: 'storage',
        heading: '5. Conservación de los Datos',
        body: [
          'Los datos se conservan durante un máximo de 5 años.',
          'Al cerrar su cuenta, el Cliente puede solicitar la eliminación de sus datos.',
          'En los casos en que exista una base legal, los datos podrán conservarse por un período más prolongado.',
        ],
      },
      {
        id: 'security',
        heading: '6. Seguridad',
        body: [
          'Aplicamos medidas de seguridad estándar para proteger los datos personales.',
          'Los datos se transmiten mediante cifrado.',
          'El acceso a los datos está restringido a un número limitado de empleados.',
        ],
      },
      {
        id: 'rights',
        heading: '7. Derechos del Cliente',
        body: [
          'El Cliente tiene los siguientes derechos:',
          '• Acceder a sus datos y obtener una copia.',
          '• Corregir datos inexactos.',
          '• Solicitar la supresión de datos en determinadas condiciones.',
          '• Limitar el tratamiento.',
          'Para ejercer estos derechos, contacte con nosotros en worldprimeonline@gmail.com.',
        ],
      },
      {
        id: 'cookies',
        heading: '8. Cookies',
        body: [
          'La plataforma utiliza cookies para mejorar la experiencia del usuario y recopilar estadísticas.',
          'Puede desactivar las cookies en la configuración de su navegador, aunque esto podría afectar a ciertos servicios.',
        ],
      },
      {
        id: 'thirdparty',
        heading: '9. Servicios de Terceros',
        body: [
          'La plataforma utiliza servicios de terceros para pagos y análisis.',
          'Dichos servicios tienen sus propias políticas de privacidad; no nos responsabilizamos de su tratamiento de datos.',
        ],
      },
      {
        id: 'children',
        heading: '10. Menores de Edad',
        body: [
          'Nuestros servicios no están dirigidos a personas menores de 18 años.',
          'No recopilamos datos de menores de forma deliberada.',
        ],
      },
      {
        id: 'changes',
        heading: '11. Cambios en la Política',
        body: [
          'Podemos modificar esta Política en cualquier momento.',
          'La Política modificada entrará en vigor tras su publicación en la plataforma.',
        ],
      },
      {
        id: 'contacts',
        heading: '12. Contacto',
        body: [
          'WorldPrimeOnline',
          'Dirección: Almaty',
          'Correo electrónico: worldprimeonline@gmail.com',
          'Sitio web: https://www.wpotranslations.org/',
        ],
      },
    ],
  },

  'personal-data-consent': {
    slug: 'personal-data-consent',
    title: 'Consentimiento para el Tratamiento de Datos Personales',
    metaTitle: 'Consentimiento para el Tratamiento de Datos Personales — WorldPrimeOnline',
    metaDescription: 'Información sobre el consentimiento para el tratamiento de datos personales.',
    effectiveDate: '2026-05-26',
    sections: [
      {
        id: 'intro',
        heading: '1. Introducción',
        body: [
          'El presente documento regula el consentimiento para el tratamiento de datos personales de los usuarios por parte de WorldPrimeOnline ().',
          LP,
        ],
      },
      {
        id: 'scope',
        heading: '2. Datos Objeto del Consentimiento',
        body: [
          'Usted otorga su consentimiento para el tratamiento de los siguientes datos:',
          '• Nombre, apellidos, patronímico.',
          '• Datos de contacto (correo electrónico, teléfono).',
          '• Documentos enviados a través de nuestro servicio.',
          '• Datos de interacción con la plataforma.',
        ],
      },
      {
        id: 'purpose',
        heading: '3. Finalidad del Tratamiento',
        body: [
          '• Prestación de los servicios.',
          '• Atención al cliente.',
          '• Mejora de la calidad del servicio.',
          '• Cumplimiento de obligaciones legales.',
        ],
      },
      {
        id: 'withdrawal',
        heading: '4. Revocación del Consentimiento',
        body: [
          'Puede revocar su consentimiento en cualquier momento contactando con nosotros en worldprimeonline@gmail.com.',
          'La revocación no afecta a la licitud del tratamiento efectuado antes de la misma.',
        ],
      },
      {
        id: 'rights',
        heading: '5. Derechos',
        body: [
          'Tiene derecho de acceso, rectificación y supresión de sus datos.',
          'Para ejercer estos derechos, puede contactar con nosotros en worldprimeonline@gmail.com.',
        ],
      },
      {
        id: 'contacts',
        heading: '6. Contacto',
        body: [
          'WorldPrimeOnline',
          'Dirección: Almaty',
          'Correo electrónico: worldprimeonline@gmail.com',
          'Sitio web: https://www.wpotranslations.org/',
        ],
      },
    ],
  },

  'refund-policy': {
    slug: 'refund-policy',
    title: 'Política de Reembolso',
    metaTitle: 'Política de Reembolso — WorldPrimeOnline',
    metaDescription: 'Condiciones de devolución en los servicios de WorldPrimeOnline.',
    effectiveDate: '2026-05-26',
    sections: [
      {
        id: 'general',
        heading: '1. Disposiciones Generales',
        body: [
          'La presente Política establece las condiciones de devolución y cambio de pagos en los servicios de la plataforma WorldPrimeOnline.',
          LP,
        ],
      },
      {
        id: 'eligible',
        heading: '2. Casos en los que Procede el Reembolso',
        body: [
          'Se procederá al reembolso en los siguientes supuestos:',
          '• Cancelación del pedido antes de que comience el servicio.',
          '• Error técnico imputable al Proveedor que impide la entrega del documento (primero se intenta el reprocesamiento; si no es posible, se reembolsa).',
          '• Cobro duplicado por error técnico.',
        ],
      },
      {
        id: 'ineligible',
        heading: '3. Casos en los que No Procede el Reembolso',
        body: [
          '• Tras la prestación completa del servicio.',
          '• Cuando el Cliente haya modificado las instrucciones o facilitado información incorrecta.',
          '• Cuando un tercero (consulado, organismo, etc.) rechace o no acepte la traducción.',
          '• Cuando el Cliente haya infringido las condiciones de la Plataforma.',
          '• Cuando el Cliente haya cambiado de opinión o considere que el pedido ya no es necesario.',
        ],
      },
      {
        id: 'process',
        heading: '4. Procedimiento de Reembolso',
        body: [
          'La solicitud deberá presentarse en un plazo de 7 (siete) días hábiles a través de worldprimeonline@gmail.com, indicando el número de pedido.',
          'La solicitud será tramitada en un plazo de 5 (cinco) días hábiles.',
          'El reembolso aprobado se realizará en un plazo de 10 (diez) días hábiles mediante el método de pago original.',
        ],
      },
      {
        id: 'partial',
        heading: '5. Reembolso Parcial',
        body: [
          'Cuando parte del servicio haya sido prestado, solo se reembolsará la parte no ejecutada.',
          'El cálculo se realizará conforme a las tarifas aplicables.',
        ],
      },
      {
        id: 'dispute',
        heading: '6. Resolución de Disputas',
        body: [
          'En caso de disputa, las Partes tratarán de resolverla en primer lugar mediante negociación directa.',
          'Si no se alcanza un acuerdo, la cuestión se resolverá conforme a la legislación de Kazajistán.',
        ],
      },
      {
        id: 'contacts',
        heading: '7. Contacto',
        body: [
          'WorldPrimeOnline',
          'Dirección: Almaty',
          'Correo electrónico: worldprimeonline@gmail.com',
          'Sitio web: https://www.wpotranslations.org/',
        ],
      },
    ],
  },

  disclaimer: {
    slug: 'disclaimer',
    title: 'Aviso Legal',
    metaTitle: 'Aviso Legal — WorldPrimeOnline',
    metaDescription: 'Sobre las limitaciones y los derechos de los servicios de WorldPrimeOnline.',
    effectiveDate: '2026-05-26',
    sections: [
      {
        id: 'general',
        heading: '1. Situación General',
        body: [
          'WorldPrimeOnline ofrece servicios de traducción y localización. El presente documento establece las limitaciones de los servicios y los supuestos de exclusión de responsabilidad del Proveedor.',
          LP,
        ],
      },
      {
        id: 'no-guarantee',
        heading: '2. Sin Garantía de Aceptación',
        body: [
          'El Proveedor no garantiza que la traducción sea aceptada por organismos públicos, consulados ni ninguna otra entidad.',
          'Los requisitos de aceptación pueden variar según la entidad y escapan a nuestro control.',
          'Antes de realizar su pedido, verifique usted mismo los requisitos aplicables.',
        ],
      },
      {
        id: 'no-legal-advice',
        heading: '3. Sin Asesoramiento Legal',
        body: [
          'WorldPrimeOnline no presta asesoramiento legal, migratorio ni fiscal en el ámbito de sus servicios.',
          'Para cuestiones jurídicas, consulte con abogados especializados.',
        ],
      },
      {
        id: 'accuracy',
        heading: '4. Exactitud de la Traducción',
        body: [
          'El Proveedor se esfuerza por ofrecer traducciones de alta calidad, pero no garantiza una exactitud del 100%.',
          'Para documentos especializados o complejos, puede ser necesaria información contextual no aportada por el Cliente.',
          'El Cliente debe revisar la traducción por su cuenta antes de presentarla ante organismos oficiales.',
        ],
      },
      {
        id: 'third-party',
        heading: '5. Decisiones de Terceros',
        body: [
          'El Proveedor no asume responsabilidad por las decisiones de consulados, organismos especializados o empresas empleadoras.',
          'No nos responsabilizamos de todos los factores que puedan influir en dichas decisiones.',
        ],
      },
      {
        id: 'liability-limit',
        heading: '6. Limitación de Responsabilidad',
        body: [
          'Los daños causados por nuestra parte se limitan al importe pagado por el pedido.',
          'No asumimos responsabilidad por daños indirectos (pérdida de ingresos, pérdida de tiempo, etc.).',
        ],
      },
      {
        id: 'contacts',
        heading: '7. Contacto',
        body: [
          'WorldPrimeOnline',
          'Dirección: Almaty',
          'Correo electrónico: worldprimeonline@gmail.com',
          'Sitio web: https://www.wpotranslations.org/',
        ],
      },
    ],
  },

  terms: {
    slug: 'terms',
    title: 'Condiciones de Uso',
    metaTitle: 'Condiciones de Uso — WorldPrimeOnline',
    metaDescription: 'Normas de uso de la plataforma WorldPrimeOnline.',
    effectiveDate: '2026-05-26',
    sections: [
      {
        id: 'acceptance',
        heading: '1. Aceptación de las Condiciones',
        body: [
          'El uso de la plataforma implica la aceptación plena de las presentes Condiciones de Uso.',
          'Si no está de acuerdo con las condiciones, deje de utilizar la plataforma.',
          LP,
        ],
      },
      {
        id: 'use',
        heading: '2. Uso de la Plataforma',
        body: [
          'La plataforma debe utilizarse únicamente con fines legales relacionados con los servicios lingüísticos.',
          'Al usar la plataforma, usted se compromete a cumplir con las obligaciones contractuales.',
          'La cuenta es de uso personal; su cesión a terceros está prohibida.',
        ],
      },
      {
        id: 'prohibited',
        heading: '3. Actividades Prohibidas',
        body: [
          '• Facilitar información falsa o fraudulenta.',
          '• Intentar vulnerar los sistemas de seguridad de la plataforma.',
          '• Intentar acceder sin autorización a los datos de otros usuarios.',
          '• Escanear la plataforma con herramientas automatizadas.',
          '• Utilizarla con fines ilegales o no autorizados.',
        ],
      },
      {
        id: 'ip',
        heading: '4. Propiedad Intelectual',
        body: [
          'El Cliente conserva los derechos de autor sobre los materiales enviados.',
          'Las traducciones realizadas por el Proveedor se transfieren al Cliente.',
          'El diseño, la marca y los textos de la plataforma son propiedad del Proveedor.',
        ],
      },
      {
        id: 'privacy',
        heading: '5. Privacidad',
        body: [
          'Las normas de tratamiento de datos de la plataforma se recogen en la Política de Privacidad.',
        ],
      },
      {
        id: 'termination',
        heading: '6. Suspensión de la Cuenta',
        body: [
          'El Proveedor se reserva el derecho de suspender a los usuarios que incumplan las condiciones.',
          'El Cliente puede cerrar su cuenta en cualquier momento; ello no afecta a los pedidos ya en curso.',
        ],
      },
      {
        id: 'changes',
        heading: '7. Modificaciones',
        body: [
          'Podemos modificar las condiciones en cualquier momento. El uso continuado de la plataforma implica la aceptación de las nuevas condiciones.',
        ],
      },
      {
        id: 'law',
        heading: '8. Legislación Aplicable',
        body: [
          'Las presentes Condiciones se rigen por la legislación de Kazajistán.',
          'Las disputas se resolverán ante el tribunal del lugar de registro del Proveedor.',
        ],
      },
      {
        id: 'contacts',
        heading: '9. Contacto',
        body: [
          'WorldPrimeOnline',
          'Dirección: Almaty',
          'Correo electrónico: worldprimeonline@gmail.com',
          'Sitio web: https://www.wpotranslations.org/',
        ],
      },
    ],
  },

  partners: {
    slug: 'partners',
    title: 'Condiciones de Colaboración',
    metaTitle: 'Condiciones de Colaboración — WorldPrimeOnline',
    metaDescription: 'Condiciones de colaboración con la plataforma WorldPrimeOnline.',
    effectiveDate: '2026-05-26',
    sections: [
      {
        id: 'intro',
        heading: '1. Introducción',
        body: [
          'El presente documento regula la relación entre la plataforma WorldPrimeOnline y los colaboradores profesionales (en adelante, el Colaborador).',
          LP,
        ],
      },
      {
        id: 'eligibility',
        heading: '2. Requisitos para la Colaboración',
        body: [
          'Para solicitar la colaboración, el candidato debe:',
          '• Contar con experiencia demostrable en el sector de los servicios lingüísticos.',
          '• Disponer de titulaciones o acreditaciones verificables.',
          '• Estar dispuesto a cumplir nuestros estándares de calidad.',
        ],
      },
      {
        id: 'engagement',
        heading: '3. Procedimiento de Colaboración',
        body: [
          'Los pedidos se asignan a los Colaboradores a través de la plataforma desde un panel específico.',
          'El Colaborador debe respetar los plazos acordados y trabajar conforme a los estándares de calidad establecidos.',
          'En caso de solicitud de corrección, el Colaborador realizará las enmiendas sin coste adicional.',
        ],
      },
      {
        id: 'payment',
        heading: '4. Remuneración del Colaborador',
        body: [
          'La remuneración se abona conforme a la tarifa estipulada en el contrato.',
          'Los pagos se realizan al final de la semana o en el plazo indicado en el contrato.',
          'Las condiciones detalladas de pago se establecen en un contrato por separado.',
        ],
      },
      {
        id: 'confidential',
        heading: '5. Confidencialidad',
        body: [
          'El Colaborador debe garantizar la plena confidencialidad de los datos del Cliente.',
          'Está prohibido transferir documentos e información del Cliente a terceros.',
          'Esta obligación permanece vigente durante al menos 3 años tras la finalización de la colaboración.',
        ],
      },
      {
        id: 'quality',
        heading: '6. Control de Calidad',
        body: [
          'El Proveedor revisa periódicamente la calidad de las traducciones.',
          'Los Colaboradores que no cumplan sistemáticamente los estándares de calidad serán dados de baja en la plataforma.',
          'Los Colaboradores son garantes de la calidad de su trabajo.',
        ],
      },
      {
        id: 'termination',
        heading: '7. Finalización de la Colaboración',
        body: [
          'Cualquiera de las partes puede poner fin a la colaboración con un preaviso de 30 (treinta) días.',
          'El incumplimiento de las condiciones dará lugar a la rescisión inmediata.',
        ],
      },
      {
        id: 'law',
        heading: '8. Legislación Aplicable',
        body: [
          'Las relaciones de colaboración se rigen por la legislación de Kazajistán.',
        ],
      },
      {
        id: 'contacts',
        heading: '9. Consultas sobre Colaboración',
        body: [
          'WorldPrimeOnline',
          'Dirección: Almaty',
          'Correo electrónico: worldprimeonline@gmail.com',
          'Sitio web: https://www.wpotranslations.org/',
        ],
      },
    ],
  },
};
