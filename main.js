document.addEventListener("DOMContentLoaded", function() {
    const url = 'book.pdf';
    const pdfViewer = document.getElementById('pdf-viewer');
    const canvas = document.getElementById('pdf-canvas');
    const ctx = canvas.getContext('2d');

    // Set the worker source from the CDN
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';

    // Load PDF
    pdfjsLib.getDocument(url).promise.then(pdf => {
        // Display the first page
        pdf.getPage(1).then(page => {
            const viewport = page.getViewport({ scale: 1.5 });
            canvas.width = viewport.width;
            canvas.height = viewport.height;

            // Render PDF page
            const renderContext = {
                canvasContext: ctx,
                viewport: viewport
            };
            page.render(renderContext);
        });
    });
});
