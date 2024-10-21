document.addEventListener("DOMContentLoaded", function() {
    const url = 'book.pdf';
    const pdfContainer = document.getElementById('pdf-container');
    const prevPageBtn = document.getElementById('prev-page');
    const nextPageBtn = document.getElementById('next-page');
    const currentPageInput = document.getElementById('current-page');
    const totalPagesElement = document.getElementById('total-pages');

    let pdfDoc = null;
    let currentPage = 1;
    let totalPages = 0;
    let pdfLoaded = false;
    let pageRendering = false;
    let pageNumPending = null;

    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';

    function loadPDF() {
        pdfjsLib.getDocument(url).promise.then(pdf => {
            pdfDoc = pdf;
            totalPages = pdf.numPages;
            totalPagesElement.textContent = totalPages;
            pdfLoaded = true;

            currentPage = parseInt(localStorage.getItem('currentPage')) || 1;
            currentPage = Math.min(Math.max(currentPage, 1), totalPages);
            currentPageInput.value = currentPage;

            renderPages();
        }).catch(error => {
            console.error('Error loading PDF:', error);
        });
    }

    function renderPages() {
        pdfContainer.innerHTML = '';
        for (let num = 1; num <= totalPages; num++) {
            renderPage(num);
        }
    }

    function renderPage(num) {
        pdfDoc.getPage(num).then(page => {
            const viewport = page.getViewport({ scale: 1 });
            const canvas = document.createElement('canvas');
            canvas.className = 'page';
            canvas.dataset.pageNumber = num;
            const context = canvas.getContext('2d');
            
            const screenWidth = window.innerWidth;
            const desiredWidth = screenWidth > 768 ? screenWidth * 0.8 : screenWidth * 0.9;
            const scale = desiredWidth / viewport.width;
            
            const scaledViewport = page.getViewport({ scale: scale });

            canvas.height = scaledViewport.height;
            canvas.width = scaledViewport.width;

            const renderContext = {
                canvasContext: context,
                viewport: scaledViewport
            };

            page.render(renderContext);
            pdfContainer.appendChild(canvas);

            if (num === currentPage) {
                scrollToPage(currentPage);
            }
        });
    }

    function scrollToPage(pageNumber) {
        const pageElement = pdfContainer.querySelector(`.page[data-page-number="${pageNumber}"]`);
        if (pageElement) {
            pageElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }

    function updatePage(newPage) {
        currentPage = newPage;
        currentPageInput.value = currentPage;
        scrollToPage(currentPage);
        localStorage.setItem('currentPage', currentPage);
    }

    prevPageBtn.addEventListener('click', () => {
        if (currentPage > 1) {
            updatePage(currentPage - 1);
        }
    });

    nextPageBtn.addEventListener('click', () => {
        if (currentPage < totalPages) {
            updatePage(currentPage + 1);
        }
    });

    currentPageInput.addEventListener('change', () => {
        const pageNumber = parseInt(currentPageInput.value);
        if (pageNumber >= 1 && pageNumber <= totalPages && pageNumber !== currentPage) {
            updatePage(pageNumber);
        }
    });

    pdfContainer.addEventListener('scroll', () => {
        const pageHeight = pdfContainer.firstElementChild.offsetHeight;
        const scrollPosition = pdfContainer.scrollTop;
        const currentPageNumber = Math.floor(scrollPosition / pageHeight) + 1;
        if (currentPageNumber !== currentPage) {
            currentPage = currentPageNumber;
            currentPageInput.value = currentPage;
            localStorage.setItem('currentPage', currentPage);
        }
    });

    let touchStartX = 0;
    let touchEndX = 0;
    
    function checkSwipe() {
        if (touchEndX < touchStartX && currentPage < totalPages) updatePage(currentPage + 1);
        if (touchEndX > touchStartX && currentPage > 1) updatePage(currentPage - 1);
    }

    document.addEventListener('touchstart', e => {
        touchStartX = e.changedTouches[0].screenX;
    });

    document.addEventListener('touchend', e => {
        touchEndX = e.changedTouches[0].screenX;
        checkSwipe();
    });

    window.addEventListener('resize', () => {
        renderPages();
        scrollToPage(currentPage);
    });

    loadPDF();
});