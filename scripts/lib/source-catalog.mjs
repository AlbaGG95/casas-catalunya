import {MAX_PRICE,MIN_BEDROOMS} from "../../search-criteria.js";

export const PROVINCES=[
  {name:"Barcelona",slug:"barcelona"},
  {name:"Tarragona",slug:"tarragona"},
  {name:"Girona",slug:"girona"},
  {name:"Lleida",slug:"lleida"}
];

function add(out,source){
  out.push({
    variant:"primary",
    ...source
  });
}

export function buildSourceDefinitions({mode="recent",scanProvider="",scanProvince=""}={}){
  const normalizedMode=mode==="deep"?"deep":"recent";
  const out=[];

  for(const p of PROVINCES){
    add(out,{
      provider:"Fotocasa",province:p.name,kind:"recent",variant:"chalets-48h",
      base:`https://www.fotocasa.es/es/comprar/chalets/${p.slug}-provincia/todas-las-zonas/publicado-ultimas-48-horas/l?priceMax=${MAX_PRICE}&bedroomsMin=${MIN_BEDROOMS}`,
      pages:1,maxDetails:normalizedMode==="deep"?80:50
    });

    if(normalizedMode==="deep"){
      add(out,{
        provider:"Fotocasa",province:p.name,kind:"deep",variant:"chalets-full",
        base:`https://www.fotocasa.es/es/comprar/chalets/${p.slug}-provincia/todas-las-zonas/l?priceMax=${MAX_PRICE}&bedroomsMin=${MIN_BEDROOMS}`,
        pages:1,maxDetails:100
      });
    }

    // Habitaclia exposes both "chalets" and the broader "casas" catalogue.
    // We scan both and deduplicate by canonical detail URL downstream.
    add(out,{
      provider:"Habitaclia",province:p.name,kind:normalizedMode==="recent"?"recentish":"deep",variant:"chalets",
      base:`https://www.habitaclia.com/comprar/chalets/${p.slug}-provincia/baratos/s`,
      pages:normalizedMode==="deep"?12:3,maxDetails:normalizedMode==="deep"?160:55
    });
    add(out,{
      provider:"Habitaclia",province:p.name,kind:normalizedMode==="recent"?"recentish":"deep",variant:"casas",
      base:`https://www.habitaclia.com/comprar/casas/${p.slug}-provincia/baratos/s`,
      pages:normalizedMode==="deep"?12:3,maxDetails:normalizedMode==="deep"?160:55
    });

    add(out,{
      provider:"Pisos.com",province:p.name,kind:normalizedMode==="recent"?"recentish":"deep",variant:"casas-3plus",
      base:`https://www.pisos.com/venta/casas-${p.slug}/con-${MIN_BEDROOMS}-habitaciones/hasta-${MAX_PRICE}/`,
      pages:normalizedMode==="deep"?16:4,maxDetails:normalizedMode==="deep"?190:70
    });

    // Broad Yaencontre casas search captures detached houses that are not tagged as "chalet".
    add(out,{
      provider:"Yaencontre",province:p.name,kind:normalizedMode==="recent"?"recentish":"deep",variant:"casas",
      base:`https://www.yaencontre.com/venta/casas/${p.slug}-provincia`,
      pages:1,maxDetails:normalizedMode==="deep"?140:65
    });
    add(out,{
      provider:"Yaencontre",province:p.name,kind:normalizedMode==="recent"?"recentish":"deep",variant:"chalets",
      base:`https://www.yaencontre.com/venta/casas/${p.slug}-provincia/t-chalets`,
      pages:1,maxDetails:normalizedMode==="deep"?120:55
    });

    add(out,{
      provider:"Servihabitat",province:p.name,kind:normalizedMode==="recent"?"recentish":"deep",variant:"vivienda",
      base:`https://www.servihabitat.com/es/venta/vivienda/${p.slug}`,
      pages:1,maxDetails:normalizedMode==="deep"?120:50
    });

    add(out,{
      provider:"Idealista",province:p.name,kind:normalizedMode==="recent"?"recentish":"deep",variant:"independientes",
      base:`https://www.idealista.com/venta-viviendas/${p.slug}-provincia/con-chalets-independientes,precio-hasta_${MAX_PRICE}/`,
      pages:normalizedMode==="deep"?8:2,maxDetails:normalizedMode==="deep"?140:55
    });

    add(out,{
      provider:"Indomio",province:p.name,kind:normalizedMode==="recent"?"recentish":"deep",variant:"jardin",
      base:`https://www.indomio.es/venta-casas/${p.slug}-provincia/con-jardin/`,
      pages:normalizedMode==="deep"?8:2,maxDetails:normalizedMode==="deep"?120:45
    });
  }

  return out.filter(src=>
    (!scanProvider||src.provider===scanProvider)&&
    (!scanProvince||src.province===scanProvince)
  );
}

export function sourceDefinitionKey(src){
  return [src.provider,src.province,src.kind,src.variant||"primary"].join(" ");
}
