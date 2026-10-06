export const safetyV2Cases=[
  {
    id:"occupied-riells",
    title:"Chalet en venta en Riells I Viabrea",
    text:"Inmueble actualmente ocupado. Casa unifamiliar aislada situada en urbanización residencial.",
    expected:"REJECT",
    reason:"occupied"
  },
  {
    id:"occupied-sils",
    title:"Chalet en venta en Sils",
    text:"Inmueble actualmente ocupado. Vivienda unifamiliar sobre amplia parcela.",
    expected:"REJECT",
    reason:"occupied"
  },
  {
    id:"construction-talamanca",
    title:"Casa en construcción",
    text:"Casa en proceso de construcción, se vende en su estado actual para terminar. Estructura ya construida.",
    expected:"REJECT",
    reason:"unfinished_construction"
  },
  {
    id:"construction-moia",
    title:"Casa aislada",
    text:"Casa aislada de 230m2 construidos, obra nueva en construcción.",
    expected:"REJECT",
    reason:"unfinished_construction"
  },
  {
    id:"construction-pont",
    title:"Casa independiente",
    text:"La casa se encuentra inscrita en construcción. Falta la finalización.",
    expected:"REJECT",
    reason:"unfinished_construction"
  },
  {
    id:"rustic-torrefarrera",
    title:"Torre con parcela",
    text:"Vivienda de 101 m² construidos sobre una parcela rústica de 22.000 m².",
    expected:"REJECT",
    reason:"rustic"
  },
  {
    id:"camping-malgrat",
    title:"Casa en venta",
    text:"Vivienda tipo bungalow ubicada en zona camping.",
    expected:"REJECT",
    reason:"camping_bungalow"
  },
  {
    id:"bungalow-fogars",
    title:"Casa en venta",
    text:"Terreno de 708 m² con un bungalow de unos 40 m².",
    expected:"REJECT",
    reason:"camping_bungalow"
  },
  {
    id:"needs-improvements-casserres",
    title:"Casa en venta",
    text:"Estado del inmueble: necesita mejoras.",
    expected:"REVIEW",
    reason:"condition_uncertain"
  },
  {
    id:"semireformed",
    title:"Casa semireformada",
    text:"Casa semireformada de tres habitaciones y patio.",
    expected:"REVIEW",
    reason:"condition_uncertain"
  },
  {
    id:"ready-to-live",
    title:"Casa independiente reformada",
    text:"Casa independiente reformada integralmente recientemente, en muy buen estado y lista para entrar a vivir.",
    expected:"ACCEPT",
    reason:"ready"
  },
  {
    id:"positive-with-contradiction",
    title:"Obra nueva",
    text:"Obra nueva en construcción. Vivienda pendiente de terminar.",
    expected:"REJECT",
    reason:"unfinished_construction"
  },
  {
    id:"good-but-unspecified",
    title:"Chalet independiente con jardín",
    text:"Chalet independiente de 4 habitaciones con jardín privado y garaje.",
    expected:"REVIEW",
    reason:"condition_unknown"
  }
];

export const baselineKnownActiveFalsePositives=[
  "5c7012f9-74c5-45e7-9e55-1a4253b68a2c",
  "b0e5c792-a440-4355-b89e-434ee3cf96c8",
  "93e620d6-f853-462a-805d-dd76fd3394ee",
  "dc39fdd5-1a8b-48a8-9312-1ee7b13f4848",
  "fd3b4c62-288d-4172-8b1f-ff031921df08",
  "48c0ded4-2a44-4e3d-8896-58d69459e6b6",
  "3a368121-5c6f-4e35-83c6-764050df08f9",
  "c9adb851-8ddc-4782-9f53-208f17b147e7",
  "d95545b8-f776-4932-a840-6301b788c7b5",
  "13639c87-fbea-4152-b677-2c459f4f7d38",
  "9f279536-9ab2-483c-b6a5-8ff8d7a9d114",
  "da71d73e-a0b1-4c93-9a5d-ce06315c2229"
];
