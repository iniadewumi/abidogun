// Mobile viewport height fix
function setVH() {
    let vh = window.innerHeight * 0.01;
    document.documentElement.style.setProperty('--vh', `${vh}px`);
}

setVH();
window.addEventListener('resize', setVH);
window.addEventListener('orientationchange', setVH);

document.addEventListener("DOMContentLoaded", function() {
    const url = 'Abidogun.pdf';
    const pdfContainer = document.getElementById('pdf-container');
    const prevPageBtn = document.getElementById('prev-page');
    const nextPageBtn = document.getElementById('next-page');
    const currentPageInput = document.getElementById('current-page');
    const totalPagesElement = document.getElementById('total-pages');

    let pdfDoc = null;
    let currentPage = 1;
    let totalPages = 0;
    let pageRendering = false;
    let pageNumPending = null;
    let scale = 1;

    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';

    function loadPDF() {
        pdfjsLib.getDocument(url).promise.then(pdf => {
            pdfDoc = pdf;
            totalPages = pdf.numPages;
            totalPagesElement.textContent = totalPages;

            currentPage = parseInt(localStorage.getItem('currentPage')) || 1;
            currentPage = Math.min(Math.max(currentPage, 1), totalPages);
            currentPageInput.value = currentPage;

            renderPage(currentPage);
        }).catch(error => {
            console.error('Error loading PDF:', error);
            pdfContainer.innerHTML = '<p>Error loading PDF. Please try again later.</p>';
        });
    }

    function renderPage(num) {
        pageRendering = true;
        pdfDoc.getPage(num).then(page => {
            const pixelRatio = window.devicePixelRatio || 1;
            const viewport = page.getViewport({ scale: scale });
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');

            canvas.height = viewport.height * pixelRatio;
            canvas.width = viewport.width * pixelRatio;
            canvas.style.height = viewport.height + "px";
            canvas.style.width = viewport.width + "px";

            const renderContext = {
                canvasContext: context,
                viewport: viewport,
                transform: [pixelRatio, 0, 0, pixelRatio, 0, 0]
            };

            const renderTask = page.render(renderContext);

            renderTask.promise.then(() => {
                pageRendering = false;
                if (pageNumPending !== null) {
                    renderPage(pageNumPending);
                    pageNumPending = null;
                }
            });

            pdfContainer.innerHTML = '';
            pdfContainer.appendChild(canvas);

            currentPage = num;
            currentPageInput.value = num;
            localStorage.setItem('currentPage', num);
            updateUI();
        });
    }

    function queueRenderPage(num) {
        if (pageRendering) {
            pageNumPending = num;
        } else {
            renderPage(num);
        }
    }

    function changePage(offset) {
        const newPage = currentPage + offset;
        if (newPage >= 1 && newPage <= totalPages) {
            queueRenderPage(newPage);
        }
    }

    function updateUI() {
        prevPageBtn.disabled = currentPage <= 1;
        nextPageBtn.disabled = currentPage >= totalPages;
    }

    prevPageBtn.addEventListener('click', () => changePage(-1));
    nextPageBtn.addEventListener('click', () => changePage(1));

    currentPageInput.addEventListener('change', () => {
        const pageNum = parseInt(currentPageInput.value);
        if (pageNum >= 1 && pageNum <= totalPages && pageNum !== currentPage) {
            queueRenderPage(pageNum);
        }
    });

    let touchStartX = 0;
    let touchStartY = 0;

    pdfContainer.addEventListener('touchstart', e => {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
    });

    pdfContainer.addEventListener('touchend', e => {
        const touchEndX = e.changedTouches[0].clientX;
        const touchEndY = e.changedTouches[0].clientY;
        const deltaX = touchEndX - touchStartX;
        const deltaY = touchEndY - touchStartY;

        if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 50) {
            if (deltaX > 0) {
                changePage(-1);
            } else {
                changePage(1);
            }
        }
    });

    function handleZoom(event) {
        event.preventDefault();
        scale += event.deltaY * -0.001;
        scale = Math.min(Math.max(0.5, scale), 3);
        renderPage(currentPage);
    }

    pdfContainer.addEventListener('wheel', handleZoom);

    window.addEventListener('resize', () => {
        if (pdfDoc) {
            renderPage(currentPage);
        }
    });

    loadPDF();
});

let currentScale = 1;
let startDist = 0;

pdfContainer.addEventListener('touchstart', e => {
    if (e.touches.length === 2) {
        startDist = Math.hypot(
            e.touches[0].pageX - e.touches[1].pageX,
            e.touches[0].pageY - e.touches[1].pageY
        );
    }
});

pdfContainer.addEventListener('touchmove', e => {
    e.preventDefault();
    if (e.touches.length === 2) {
        const dist = Math.hypot(
            e.touches[0].pageX - e.touches[1].pageX,
            e.touches[0].pageY - e.touches[1].pageY
        );
        currentScale *= dist / startDist;
        currentScale = Math.min(Math.max(1, currentScale), 3);  // Limit zoom between 1x and 3x
        startDist = dist;
        scale = currentScale;
        renderPage(currentPage);
    }
});