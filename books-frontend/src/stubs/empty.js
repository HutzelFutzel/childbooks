// Empty stub for jsPDF's optional peer dependencies (canvg / html2canvas /
// dompurify). We only embed pre-rasterized images into PDFs, so the SVG/HTML
// code paths that would import these modules are never executed. Aliasing them
// here keeps both the dev optimizer and the production build from trying to
// resolve packages we intentionally don't install.
export default {};
