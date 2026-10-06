const ADAPTERS={
  "Fotocasa":{
    detail:/\/es\/comprar\/vivienda\//i,
    embedded:[
      /https?:\\?\/\\?\/www\.fotocasa\.es\\?\/es\\?\/comprar\\?\/vivienda\\?\/[^"'<>\s]+/gi,
      /\/es\/comprar\/vivienda\/[^"'<>\s]+/gi
    ]
  },
  "Habitaclia":{
    detail:/\/comprar\/(?:vivienda|casa|chalet)\//i,
    require:/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/d(?:\?|$)/i,
    embedded:[
      /https?:\\?\/\\?\/www\.habitaclia\.com\\?\/comprar\\?\/(?:vivienda|casa|chalet)\\?\/[^"'<>\s]*?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\?\/d/gi,
      /\/comprar\/(?:vivienda|casa|chalet)\/[^"'<>\s]*?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/d/gi
    ]
  },
  "Pisos.com":{
    detail:/\/comprar\//i,
    reject:/\/venta\//i,
    embedded:[
      /https?:\\?\/\\?\/www\.pisos\.com\\?\/comprar\\?\/[^"'<>\s]+/gi,
      /\/comprar\/[^"'<>\s]+/gi
    ]
  },
  "Yaencontre":{
    detail:/\/venta\/casa\/inmueble-\d+-\d+/i,
    embedded:[
      /https?:\\?\/\\?\/www\.yaencontre\.com\\?\/venta\\?\/casa\\?\/inmueble-\d+-\d+/gi,
      /\/venta\/casa\/inmueble-\d+-\d+/gi
    ]
  },
  "Servihabitat":{
    detail:/\/es\/venta\/vivienda-casa\/.+\/\d+\/?$/i,
    embedded:[
      /https?:\\?\/\\?\/www\.servihabitat\.com\\?\/es\\?\/venta\\?\/vivienda-casa\\?\/[^"'<>\s]+\\?\/\d+/gi,
      /\/es\/venta\/vivienda-casa\/[^"'<>\s]+\/\d+/gi
    ]
  },
  "Idealista":{
    detail:/\/inmueble\/\d+\/?/i,
    embedded:[
      /https?:\\?\/\\?\/(?:www\.)?idealista\.com\\?\/inmueble\\?\/\d+\\?\/?/gi,
      /\/inmueble\/\d+\/?/gi
    ]
  },
  "Indomio":{
    detail:/\/anuncios\/\d+\/?/i,
    embedded:[
      /https?:\\?\/\\?\/www\.indomio\.es\\?\/anuncios\\?\/\d+\\?\/?/gi,
      /\/anuncios\/\d+\/?/gi
    ]
  }
};

export function isDetailUrl(provider,url){
  const a=ADAPTERS[provider];
  if(!a)return false;
  const value=String(url||"");
  if(!a.detail.test(value))return false;
  if(a.require&&!a.require.test(value))return false;
  if(a.reject&&a.reject.test(value))return false;
  return true;
}

export function embeddedDetailPatterns(provider){
  return (ADAPTERS[provider]?.embedded||[]).map(rx=>new RegExp(rx.source,rx.flags));
}

export function supportedProviders(){
  return Object.keys(ADAPTERS);
}


export function canonicalListingUrl(input){
  try{
    const u=new URL(String(input||""));
    u.hash="";
    for(const key of [...u.searchParams.keys()]){
      if(/^(from|utm_|source|campaign|medium|ref)/i.test(key))u.searchParams.delete(key);
    }
    return u.toString();
  }catch{
    return String(input||"");
  }
}
