// Public H5 paths are independent of the mini-program's source directories.
export function h5PagePath(path){
 const [pathname,...query]=path.split('?');
 const route=pathname==='/'||pathname==='/pages/home/index'?'/':pathname.replace(/^\/pages\//,'/').replace(/\/index$/,'');
 return route+(query.length?'?'+query.join('?'):'');
}
