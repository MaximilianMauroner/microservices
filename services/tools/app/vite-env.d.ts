declare module "*.css";

declare module "*.png?url" {
  const url: string;
  export default url;
}

declare module "*.png?url&no-inline" {
  const url: string;
  export default url;
}
